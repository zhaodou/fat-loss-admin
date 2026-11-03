import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { db, nowIso } from '../db'
import { MEAL_LABEL, MEAL_TYPES, UPLOAD_DIR, type MealType } from '../config'
import { getDayContext, getDietEntries, summarizeDiet } from '../services/data'
import { clearDietMeal, insertDietEntries } from '../services/diet'
import { recognizePhoto } from '../services/recognizer'
import { asyncRoute, num, optionalNum, reqDate, str, today } from './helpers'

export const dietRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })

/* --------------------------------- 饮食记录 ------------------------------- */

/**
 * 计算一条记录的营养值。
 * - 有 food_id：按食物库的每100g营养 × 新重量重算；
 * - 没有 food_id（如 AI 分析记录）：按「原营养 × 新重量 / 原重量」等比缩放，
 *   保证用户改重量后热量和三大营养素同步变化，而不是沿用旧值。
 */
function computeEntry(foodId: number | null, amount: number, fallback: any, prevAmount?: number) {
  if (foodId) {
    const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(foodId) as any
    if (food) {
      const r = amount / 100
      return {
        food_name: food.name,
        food_kind: food.kind ?? 'ingredient',
        kcal: Math.round(food.kcal * r),
        protein: Math.round(food.protein * r * 10) / 10,
        carb: Math.round(food.carb * r * 10) / 10,
        fat: Math.round(food.fat * r * 10) / 10,
        fiber: Math.round(food.fiber * r * 10) / 10,
      }
    }
  }
  const from = num(prevAmount ?? fallback.amount_g)
  const ratio = from > 0 && amount > 0 ? amount / from : 1
  const scale1 = (v: unknown) => Math.round(num(v) * ratio * 10) / 10
  return {
    food_name: str(fallback.food_name, '自定义食物'),
    food_kind: 'ingredient',
    kcal: Math.round(num(fallback.kcal) * ratio),
    protein: scale1(fallback.protein),
    carb: scale1(fallback.carb),
    fat: scale1(fallback.fat),
    fiber: scale1(fallback.fiber),
  }
}

dietRouter.get(
  '/diet/day',
  asyncRoute((req, res) => {
    const date = reqDate(req)
    const ctx = getDayContext(date)
    const photos = db.prepare('SELECT * FROM meal_photos WHERE date = ?').all(date) as any[]
    const meals = MEAL_TYPES.map((type) => {
      const items = ctx.diet.filter((d) => d.meal_type === type)
      const subtotal = summarizeDiet(items)
      return {
        type,
        label: MEAL_LABEL[type],
        items,
        subtotal: { kcal: subtotal.kcal, protein: subtotal.protein, carb: subtotal.carb, fat: subtotal.fat },
        raw_text: items.find((i) => i.raw_text)?.raw_text ?? '',
        photos: photos
          .filter((p) => p.meal_type === type)
          .map((p) => ({ id: p.id, url: p.url, recognized: p.recognized ? JSON.parse(p.recognized) : null })),
      }
    })
    res.json({
      date,
      meals,
      totals: ctx.dietTotals,
      target: {
        intake: Math.max(ctx.energy.intakeFloor, ctx.energy.tdee - ctx.plannedDeficit),
        tdee: ctx.energy.tdee,
        plannedDeficit: ctx.plannedDeficit,
        floor: ctx.energy.intakeFloor,
      },
      energy: ctx.energy,
      remaining: Math.round(Math.max(ctx.energy.intakeFloor, ctx.energy.tdee - ctx.plannedDeficit) - ctx.dietTotals.kcal),
    })
  }),
)

dietRouter.post(
  '/diet/entries',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const date = str(b.date, today())
    const rawText = str(b.raw_text, '')
    const items: any[] = Array.isArray(b.items) ? b.items : [b]
    const inserted: number[] = []
    const stmt = db.prepare(
      `INSERT INTO diet_entries (date, meal_type, food_id, food_name, amount_g, kcal, protein, carb, fat, fiber, photo, source, food_kind, raw_text, basis, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const run = db.transaction(() => {
      for (const item of items) {
        const mealType = (MEAL_TYPES as readonly string[]).includes(item.meal_type) ? item.meal_type : 'snack'
        const amount = num(item.amount_g, 100)
        const calc = computeEntry(optionalNum(item.food_id), amount, item)
        const info = stmt.run(
          str(item.date, date),
          mealType,
          optionalNum(item.food_id),
          calc.food_name,
          amount,
          calc.kcal,
          calc.protein,
          calc.carb,
          calc.fat,
          calc.fiber,
          item.photo ?? null,
          str(item.source, 'manual'),
          calc.food_kind,
          rawText || null,
          str(item.basis, '') || null,
          nowIso(),
        )
        inserted.push(Number(info.lastInsertRowid))
      }
    })
    run()
    res.json({ ok: true, ids: inserted })
  }),
)

/**
 * 整餐替换：先删掉该日期 + 餐次的全部记录，再插入新的一组。
 * 用于「整体编辑 + 重新计算」——用户改完描述重新点计算后，用这一餐的最新结果覆盖旧记录。
 */
dietRouter.put(
  '/diet/meal',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const date = str(b.date, today())
    const mealType = (MEAL_TYPES as readonly string[]).includes(b.meal_type) ? b.meal_type : 'snack'
    const rawText = str(b.raw_text, '')
    const items: any[] = Array.isArray(b.items) ? b.items : []
    if (!items.length) throw new Error('没有可保存的食物')
    clearDietMeal(date, mealType)
    const ids = insertDietEntries(date, items.map((it) => ({ ...it, date, meal_type: mealType, raw_text: rawText || null })))
    res.json({ ok: true, ids, count: ids.length })
  }),
)

/** 批量删除（撤销助手自动记录时用） */
dietRouter.post(
  '/diet/entries/delete',
  asyncRoute((req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => num(x)).filter((x: number) => Number.isFinite(x)) : []
    if (!ids.length) throw new Error('没有要删除的记录')
    const stmt = db.prepare('DELETE FROM diet_entries WHERE id = ?')
    const run = db.transaction(() => {
      for (const id of ids) stmt.run(id)
    })
    run()
    res.json({ ok: true, deleted: ids.length })
  }),
)

dietRouter.put(
  '/diet/entries/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM diet_entries WHERE id = ?').get(id) as any
    if (!row) throw new Error('记录不存在')
    const b = req.body ?? {}
    const amount = num(b.amount_g, row.amount_g)
    const mealType = (MEAL_TYPES as readonly string[]).includes(b.meal_type) ? b.meal_type : row.meal_type
    const calc = computeEntry(optionalNum(b.food_id) ?? row.food_id, amount, { ...row, ...b }, row.amount_g)
    db.prepare('UPDATE diet_entries SET meal_type = ?, amount_g = ?, food_name = ?, kcal = ?, protein = ?, carb = ?, fat = ?, fiber = ? WHERE id = ?').run(
      mealType,
      amount,
      calc.food_name,
      calc.kcal,
      calc.protein,
      calc.carb,
      calc.fat,
      calc.fiber,
      id,
    )
    res.json({ ok: true, entry: { id, meal_type: mealType, amount_g: amount, ...calc } })
  }),
)

dietRouter.delete(
  '/diet/entries/:id',
  asyncRoute((req, res) => {
    db.prepare('DELETE FROM diet_entries WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)

dietRouter.delete(
  '/diet/day',
  asyncRoute((req, res) => {
    const date = reqDate(req)
    const meal = str(req.query.meal_type as string)
    if (meal && (MEAL_TYPES as readonly string[]).includes(meal)) {
      db.prepare('DELETE FROM diet_entries WHERE date = ? AND meal_type = ?').run(date, meal)
    } else {
      db.prepare('DELETE FROM diet_entries WHERE date = ?').run(date)
    }
    res.json({ ok: true })
  }),
)

dietRouter.post(
  '/diet/copy',
  asyncRoute((req, res) => {
    const from = str(req.body?.from)
    const to = str(req.body?.to, today())
    if (!from || !to) throw new Error('需要提供 from / to 日期')
    const rows = getDietEntries(from)
    if (!rows.length) throw new Error('源日期没有记录')
    const stmt = db.prepare(
      `INSERT INTO diet_entries (date, meal_type, food_id, food_name, amount_g, kcal, protein, carb, fat, fiber, photo, source, food_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'copy', ?, ?)`,
    )
    const run = db.transaction(() => {
      for (const r of rows) {
        stmt.run(
          to,
          r.meal_type,
          r.food_id,
          r.food_name,
          r.amount_g,
          r.kcal,
          r.protein,
          r.carb,
          r.fat,
          r.fiber,
          r.photo,
          (r as any).food_kind ?? 'ingredient',
          nowIso(),
        )
      }
    })
    run()
    res.json({ ok: true, copied: rows.length })
  }),
)

/* -------------------------------- 照片识别 -------------------------------- */

dietRouter.post(
  '/diet/photo',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const file = req.file
    if (!file) throw new Error('没有收到图片')
    const mealType = ((MEAL_TYPES as readonly string[]).includes(str(req.body?.meal_type)) ? req.body.meal_type : 'lunch') as MealType
    const date = str(req.body?.date, today())

    const ext = path.extname(file.originalname) || '.jpg'
    const filename = `${date}-${mealType}-${Date.now()}${ext}`
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer)

    const result = await recognizePhoto({
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
      mealType,
    })

    const url = `/uploads/${filename}`
    db.prepare('INSERT INTO meal_photos (date, meal_type, url, recognized, created_at) VALUES (?, ?, ?, ?, ?)').run(
      date,
      mealType,
      url,
      JSON.stringify(result),
      nowIso(),
    )

    res.json({ ok: true, url, meal_type: mealType, ...result })
  }),
)

dietRouter.delete(
  '/diet/photo/:id',
  asyncRoute((req, res) => {
    const row = db.prepare('SELECT * FROM meal_photos WHERE id = ?').get(Number(req.params.id)) as any
    if (!row) throw new Error('照片不存在')
    const abs = path.join(UPLOAD_DIR, path.basename(row.url))
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
    db.prepare('DELETE FROM meal_photos WHERE id = ?').run(row.id)
    res.json({ ok: true })
  }),
)
