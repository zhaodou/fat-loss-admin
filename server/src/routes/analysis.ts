/**
 * AI 饮食热量分析路由
 * ---------------------------------------------------------------------------
 *   POST /api/diet/analysis/images  图片上传（multipart，≤5 张，与分析分离）
 *   POST /api/diet/analysis         分析（图片 url + 文字描述 → 结构化结果，不落库）
 *   POST /api/diet/analysis/save    确认保存（图片入 meal_photos、食物入 diet_entries）
 *
 * 落库设计（不动历史数据）：
 *   - 图片写进既有的 meal_photos（recognized 列存完整分析 JSON），餐卡照片墙照常展示；
 *   - 食物逐条写 diet_entries（source='ai-vision'，raw_text=描述，basis=识别备注），
 *     每日总摄入 / 三大营养素 / 热量分布全部自动联动；
 *   - AI 只给了热量没给宏量时，用本地食物库按重量补齐蛋白/碳水/脂肪/纤维。
 */
import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { db, nowIso } from '../db'
import { MEAL_TYPES, UPLOAD_DIR, type MealType } from '../config'
import { insertDietEntries } from '../services/diet'
import { findLocal } from '../services/nutrition'
import { analyzeMeal, type AnalysisFoodItem, type MealAnalysisResult } from '../services/visionAnalysis'
import { asyncRoute, num, str, today } from './helpers'

export const analysisRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } })
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

function mealTypeOf(v: unknown, fallback: MealType = 'lunch'): MealType {
  return (MEAL_TYPES as readonly string[]).includes(String(v)) ? (v as MealType) : fallback
}

const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function normalizeImageUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((u) => String(u ?? '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

/** 读取已上传图片为 base64（basename 防路径穿越） */
function readImages(urls: string[]): { mime: string; base64: string }[] {
  return urls.map((u) => {
    const abs = path.join(UPLOAD_DIR, path.basename(u))
    if (!fs.existsSync(abs)) throw new Error(`图片已不存在：${u}，请重新上传`)
    const buf = fs.readFileSync(abs)
    return { mime: mimeFromExt(path.extname(abs)), base64: buf.toString('base64') }
  })
}

/* ---------------------------- 1. 图片上传 ---------------------------- */

analysisRouter.post(
  '/diet/analysis/images',
  upload.array('files', 5),
  asyncRoute((req, res) => {
    const files = req.files as Express.Multer.File[] | undefined
    if (!files?.length) throw new Error('没有收到图片')
    if (files.length > 5) throw new Error('一次最多上传 5 张图片')
    const urls: string[] = []
    for (const f of files) {
      if (!ALLOWED_MIME.has(f.mimetype)) {
        throw new Error(`不支持的图片格式：${f.originalname}（仅支持 JPG / PNG / WEBP）`)
      }
      const ext = EXT_BY_MIME[f.mimetype] || path.extname(f.originalname) || '.jpg'
      const filename = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), f.buffer)
      urls.push(`/uploads/${filename}`)
    }
    res.json({ ok: true, urls })
  }),
)

/* ---------------------------- 2. AI 分析 ---------------------------- */

analysisRouter.post(
  '/diet/analysis',
  asyncRoute(async (req, res) => {
    const b = req.body ?? {}
    const description = str(b.description, '').trim()
    const imageUrls = normalizeImageUrls(b.imageUrls)
    if (!description && !imageUrls.length) throw new Error('请至少上传一张饮食照片或填写文字描述')

    const result = await analyzeMeal({
      description,
      mealType: mealTypeOf(b.mealType),
      images: readImages(imageUrls),
    })
    res.json({ ok: true, ...result })
  }),
)

/* ---------------------------- 3. 确认保存 ---------------------------- */

analysisRouter.post(
  '/diet/analysis/save',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const date = str(b.date, today())
    const mealType = mealTypeOf(b.mealType)
    const description = str(b.description, '').trim()
    const imageUrls = normalizeImageUrls(b.imageUrls)
    const analysis = b.analysis as MealAnalysisResult | undefined
    if (!analysis || !Array.isArray(analysis.foods) || !analysis.foods.length) {
      throw new Error('没有可保存的分析结果，请先完成热量分析')
    }

    const run = db.transaction(() => {
      // 图片 → meal_photos（recognized 存完整分析快照，方便日后回看 AI 当时的判断）
      for (const url of imageUrls) {
        const abs = path.join(UPLOAD_DIR, path.basename(url))
        if (!fs.existsSync(abs)) continue
        db.prepare('INSERT INTO meal_photos (date, meal_type, url, recognized, created_at) VALUES (?, ?, ?, ?, ?)').run(
          date,
          mealType,
          url,
          JSON.stringify({ ...analysis, description }),
          nowIso(),
        )
      }

      // 食物 → diet_entries（宏量缺失用本地库补齐）
      const items = analysis.foods.map((f: AnalysisFoodItem) => {
        const weight = num(f.weight, 100)
        let protein = num(f.protein)
        let carb = num(f.carb)
        let fat = num(f.fat)
        let fiber = num(f.fiber)
        let basis = String(f.remark ?? '').slice(0, 160)
        if (!protein && !carb && !fat) {
          const local = findLocal(f.name)
          if (local) {
            const r = weight / 100
            protein = Math.round(local.protein * r * 10) / 10
            carb = Math.round(local.carb * r * 10) / 10
            fat = Math.round(local.fat * r * 10) / 10
            fiber = Math.round(local.fiber * r * 10) / 10
            basis = `${basis ? basis + ' · ' : ''}宏量营养素由本地库按 ${weight}g 补全`
          }
        }
        return {
          meal_type: mealType,
          food_name: f.name,
          amount_g: weight,
          kcal: num(f.calories),
          protein,
          carb,
          fat,
          fiber,
          source: 'ai-vision',
          raw_text: description || null,
          basis: `AI 图片热量分析 · 置信度 ${Math.round((num(f.confidence, 0.7)) * 100)}%${basis ? ` · ${basis}` : ''}`,
        }
      })
      insertDietEntries(date, items)
    })
    run()

    res.json({ ok: true, count: analysis.foods.length, images: imageUrls.length })
  }),
)
