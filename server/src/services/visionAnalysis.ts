/**
 * AI 饮食热量分析（图片 + 文字描述 → 结构化 JSON）
 * ---------------------------------------------------------------------------
 * 「每日饮食」新版录入的核心：用户上传 0-5 张饮食照片 + 一段文字描述，
 * 后端调用多模态视觉模型，结合两者识别食物、估分量、算热量。
 *
 * 设计要点（对应需求六）：
 *   1. 复用「我的助手」的模型连接配置（resolveLlm），API Key 只存在于后端；
 *   2. 模型切换不硬编码：优先级 = 设置里的「视觉模型 visionModel」
 *      → 环境变量 VISION_MODEL → 主模型（需支持图片）；
 *   3. 图片识别失败（模型不支持视觉 / 调用出错 / 返回无法解析）时，
 *      自动降级为「纯文字分析」，图片不参与计算但会在结果中说明；
 *   4. 返回内容做严格 JSON 校验与字段纠正，异常不外抛脏数据；
 *   5. 每次分析超时 45s、失败重试 1 次；结果漏掉用户描述里明确列出的食物时，
 *      带纠正指令自动重试一次（防止小模型漏菜/换菜）。
 */
import fs from 'node:fs'
import { MEAL_LABEL, type MealType } from '../config'
import { getSettings } from '../db'
import { resolveLlm } from './assistant'
import { estimateDiet } from './nutrition'

export interface AnalysisFoodItem {
  name: string
  /** 估算重量（g） */
  weight: number
  unit: string
  /** 本项热量（kcal） */
  calories: number
  /** 每 100g 热量（kcal），便于用户核对 */
  caloriesPer100g: number
  /** 置信度 0-1 */
  confidence: number
  /** 该项的估算依据 / 备注 */
  remark: string
  /** 可选宏量营养素（g），AI 能给就给，落库前缺失会用本地库补 */
  protein?: number
  carb?: number
  fat?: number
  fiber?: number
}

export interface MealAnalysisResult {
  foods: AnalysisFoodItem[]
  totalCalories: number
  analysisSummary: string
  /** 不确定因素（如用油量无法判断） */
  uncertainties: string[]
  /** 图文冲突提示（如描述说 150g 米饭但图片明显更多） */
  conflictWarnings: string[]
  /** 分析引擎：vision-model=图片+文字 / text-only=纯文字（图片未参与）/ demo=演示数据 */
  engine: 'vision-model' | 'text-only' | 'demo'
  model: string
}

interface VisionImage {
  mime: string
  base64: string
}

/* ------------------------------ 提示词 ------------------------------ */

const SYSTEM_PROMPT = `你是一位中式饮食营养分析师。用户会提供 0-5 张饮食照片和一段文字描述，请结合两者完成热量分析。

【分析规则，必须遵守】
1. 识别照片中的食物，并用用户的文字描述修正识别结果：描述里明确提到的食物必须包含，即使照片里看不清。
2. 用户明确描述的食物重量（如「150g 米饭」）优先于你从图片估算的重量；描述没给重量的，按图片估算并在 remark 标注「估算值」。
3. 对无法准确识别的食物，不要编造具体信息，写入 uncertainties；分量为合理估算即可。
4. 如果图片和文字描述存在明显冲突（如描述一份米饭但照片里有两碗），必须在 conflictWarnings 中逐条说明。
5. 热量估算考虑烹饪方式（油炸/清炒/清蒸差别很大），炒菜把食用油单独考虑进热量。
6. 热量单位统一为 kcal；totalCalories 必须等于 foods 中各项 calories 之和。
7. confidence 为 0-1 的小数：描述了明确重量给 0.9+，图片估算给 0.6-0.85，很不确定给 0.5 以下。

【输出格式】只返回严格 JSON，不要任何解释、不要 markdown 代码块。
所有数值字段（weight/calories/caloriesPer100g/confidence/protein/carb/fat/totalCalories）必须是**直接写出的纯数字**（如 174），
绝对禁止写算式或表达式（如 150 * 116 / 100 是错误的，要直接写计算结果 174）：
{
  "foods": [
    {"name":"米饭","weight":150,"unit":"g","calories":174,"caloriesPer100g":116,"confidence":0.95,"remark":"根据用户描述的重量计算","protein":3.9,"carb":38.9,"fat":0.5},
    {"name":"西红柿炒鸡蛋","weight":200,"unit":"g","calories":220,"caloriesPer100g":110,"confidence":0.75,"remark":"根据图片估算分量","protein":8,"carb":10,"fat":14}
  ],
  "totalCalories": 394,
  "analysisSummary": "一句话概括这餐的构成和热量水平",
  "uncertainties": ["如：实际用油量无法准确判断"],
  "conflictWarnings": []
}
protein/carb/fat 为该项的宏量营养素克数，能估算就填，不能就省略。

【重要】上面 JSON 里的数值只是格式示例，绝对不要照抄示例里的食物、重量或热量，必须根据用户实际提供的照片和描述给出你自己的分析结果。`

/* ---------------------------- JSON 校验与纠正 ---------------------------- */

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function strArr(v: unknown, limit = 6): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

/** 把模型返回的任意内容洗成合法的 MealAnalysisResult；解析不出结构时抛错 */
function coerceAnalysis(raw: unknown, engine: MealAnalysisResult['engine'], model: string): MealAnalysisResult {
  if (!raw || typeof raw !== 'object') throw new Error('AI 返回内容无法解析')
  const obj = raw as Record<string, unknown>
  const rawFoods = Array.isArray(obj.foods) ? obj.foods : []

  const foods: AnalysisFoodItem[] = []
  for (const f of rawFoods.slice(0, 30)) {
    if (!f || typeof f !== 'object') continue
    const o = f as Record<string, unknown>
    const name = String(o.name ?? '').trim()
    if (!name) continue
    const weight = clampNum(o.weight, 0.5, 5000, 100)
    const calories = Math.max(0, Math.round(clampNum(o.calories, 0, 5000, 0)))
    foods.push({
      name: name.slice(0, 40),
      weight: Math.round(weight * 10) / 10,
      unit: 'g',
      calories,
      caloriesPer100g: Math.max(0, Math.round(clampNum(o.caloriesPer100g, 0, 900, weight > 0 ? (calories / weight) * 100 : 0))),
      confidence: clampNum(o.confidence, 0, 1, 0.7),
      remark: String(o.remark ?? '').slice(0, 120),
      protein: o.protein === undefined ? undefined : Math.max(0, Number(o.protein) || 0),
      carb: o.carb === undefined ? undefined : Math.max(0, Number(o.carb) || 0),
      fat: o.fat === undefined ? undefined : Math.max(0, Number(o.fat) || 0),
      fiber: o.fiber === undefined ? undefined : Math.max(0, Number(o.fiber) || 0),
    })
  }
  if (!foods.length) throw new Error('AI 没有识别出任何食物')

  // 总热量以各项之和为准（与前端编辑后的重算逻辑一致）；AI 给的总数偏差大时提示
  const sum = foods.reduce((acc, f) => acc + f.calories, 0)
  const uncertainties = strArr(obj.uncertainties)
  const givenTotal = Number(obj.totalCalories)
  if (Number.isFinite(givenTotal) && sum > 0 && Math.abs(givenTotal - sum) / Math.max(1, sum) > 0.5) {
    uncertainties.push(`AI 汇总热量（${Math.round(givenTotal)} kcal）与各项之和不一致，已按各项之和（${sum} kcal）计算`)
  }

  return {
    foods,
    totalCalories: sum,
    analysisSummary: String(obj.analysisSummary ?? '').slice(0, 300) || '已完成饮食热量分析。',
    uncertainties,
    conflictWarnings: strArr(obj.conflictWarnings, 4),
    engine,
    model,
  }
}

/** 把 JSON 里的简单四则算式（模型爱写 "calories": 150 * 116 / 100）折叠成数字结果 */
function foldArithmetic(s: string): string {
  let cur = s
  for (;;) {
    let prev = cur
    // 先乘除（含 × x 两种乘号写法）
    cur = cur.replace(
      /(\d+(?:\.\d+)?)\s*([*/×xX])\s*(\d+(?:\.\d+)?)/g,
      (_m, a: string, op: string, b: string) => {
        const r = op === '/' ? Number(a) / Number(b) : Number(a) * Number(b)
        return String(Math.round(r * 100) / 100)
      },
    )
    // 再加减（避免误伤负数字面量：仅折叠「数字 运算符 数字」）
    cur = cur.replace(
      /(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)/g,
      (_m, a: string, op: string, b: string) => {
        const r = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b)
        return String(Math.round(r * 100) / 100)
      },
    )
    if (cur === prev) return cur
  }
}

function extractJson(text: string): unknown {
  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 返回内容中没有 JSON')
  cleaned = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(cleaned)
  } catch (parseErr) {
    // 小模型返回的 JSON 常混入全角标点 / 中文引号，做一次保守修复再解析
    const repaired = foldArithmetic(
      cleaned
        .replace(/，/g, ',')
        .replace(/：/g, ':')
        .replace(/、/g, ',')
        .replace(/[“”]/g, '"')
        .replace(/【|】/g, ''),
    )
    try {
      return JSON.parse(repaired)
    } catch {
      // 仍失败：落盘原文便于排查模型输出的格式问题
      try {
        fs.writeFileSync('/tmp/vision_raw_fail.txt', cleaned)
      } catch {
        /* 忽略写盘失败 */
      }
      throw parseErr
    }
  }
}

/* ------------------------------ 模型调用 ------------------------------ */

/** 选模型：视觉模型（设置/环境变量）→ 主模型；返回 null 表示无可用连接 */
function pickModel(preferVision: boolean): { endpoint: string; apiKey: string; model: string; temperature: number } | null {
  const llm = resolveLlm()
  const settings = getSettings().ai
  const envEndpoint = process.env.VISION_ENDPOINT?.trim()
  const envKey = process.env.VISION_API_KEY?.trim()
  const envModel = process.env.VISION_MODEL?.trim()

  if (preferVision) {
    const visionModel = envModel || settings.visionModel?.trim() || ''
    // 设置了独立视觉模型 → 用主连接的地址/Key 跑视觉模型（同供应商同 Key 的典型场景，如智谱 glm-4v-flash）
    if (visionModel && llm.ready) return { endpoint: envEndpoint || llm.endpoint, apiKey: envKey || llm.apiKey, model: visionModel, temperature: 0.2 }
    // 完全独立的视觉连接（旧 recognizer 的环境变量方式）
    if (envEndpoint && envKey && envModel) return { endpoint: envEndpoint, apiKey: envKey, model: envModel, temperature: 0.2 }
  }
  if (llm.ready) return { endpoint: llm.endpoint, apiKey: llm.apiKey, model: llm.model, temperature: 0.3 }
  return null
}

async function callModel(input: {
  endpoint: string
  apiKey: string
  model: string
  temperature: number
  mealType: MealType
  description: string
  images: VisionImage[]
}): Promise<MealAnalysisResult> {
  const userText = [
    `餐次：${MEAL_LABEL[input.mealType]}。`,
    input.images.length ? `附带 ${input.images.length} 张饮食照片。` : '本次没有照片，请**仅根据下面的用户描述**分析，禁止虚构描述之外的食物。',
    input.description ? `用户描述：${input.description}` : '用户没有填写文字描述。',
    input.images.length ? '' : '用户描述中列出的每一种食物（按顿号/逗号分开的每一项）都必须在 foods 中单独一项，名称照用用户的叫法，不允许替换成其它食物，也不允许遗漏。',
    '请按系统要求的 JSON 格式返回分析结果。',
  ]
    .filter(Boolean)
    .join('\n')

  // 关键：纯文本时 content 必须用字符串。实测 glm-4-flash 等纯文本模型
  // 读不懂 [{type:'text',...}] 数组格式，会无视描述内容直接瞎编（如把描述分析成「红烧肉」）；
  // 只有带图片时才用多模态数组格式。
  const content: unknown = input.images.length
    ? [
        { type: 'text', text: userText },
        ...input.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ]
    : userText

  const resp = await fetch(input.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      temperature: input.temperature,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`模型接口返回 ${resp.status}${body ? `：${body.slice(0, 160)}` : ''}`)
  }
  const json: any = await resp.json()
  const text: string = json.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('模型返回内容为空')
  return coerceAnalysis(extractJson(text), input.images.length ? 'vision-model' : 'text-only', input.model)
}

/** 带一次重试的调用（网络抖动 / 网关 5xx 时再试一次） */
async function callWithRetry(input: Parameters<typeof callModel>[0]): Promise<MealAnalysisResult> {
  try {
    return await callModel(input)
  } catch (firstErr) {
    try {
      return await callModel(input)
    } catch {
      throw firstErr
    }
  }
}

/* ------------------------ 描述覆盖校验（防漏菜） ------------------------ */

/** 去掉数量词取菜名主干，如「一个馒头」→「馒头」 */
function dishCore(seg: string): string {
  return seg
    .replace(/^[一两二三四五六七八九十半\d]+\s*(个|只|碗|份|块|条|根|片|勺|盒|杯|盘|碟|例)?/g, '')
    .replace(/\d+(?:\.\d+)?\s*(g|克|毫升|ml)\s*$/i, '')
    .trim()
}

/** 两段文字的字符重合率（「西蓝花/西兰花」这类别字也能对上） */
function charOverlap(a: string, b: string): number {
  const setA = new Set(a)
  const setB = new Set(b)
  const hit = [...setB].filter((c) => setA.has(c)).length
  return hit / Math.max(1, setB.size)
}

/** 找出「用户描述里明确列出、但结果里没有」的食物名 */
function missingFromDescription(description: string, foods: { name: string }[]): string[] {
  if (!description.trim()) return []
  const segs = description
    .split(/[，,、;；。\s]+/)
    .map((s) => dishCore(s))
    .filter((s) => s.length >= 2)
  const names = foods.map((f) => f.name)
  const missing: string[] = []
  for (const seg of segs) {
    const covered = names.some((n) => n.includes(seg) || seg.includes(n) || charOverlap(n, seg) >= 0.6)
    if (!covered) missing.push(seg)
  }
  return missing
}

/** 分析 + 描述覆盖校验：结果漏掉用户明确列出的食物时，带纠正指令再试一次，取覆盖更好的一版 */
async function callWithCoverage(input: Parameters<typeof callModel>[0]): Promise<MealAnalysisResult> {
  const result = await callWithRetry(input)
  const missing = missingFromDescription(input.description, result.foods)
  if (!missing.length) return result
  try {
    const corrective = await callModel({
      ...input,
      description: `${input.description}\n\n【纠正】你上一次的回复遗漏或替换了用户明确列出的这些食物：${missing.join('、')}。请重新分析：用户描述中列出的每一种食物都必须在 foods 中单独成项、名称沿用用户的叫法，禁止虚构描述之外的食物。`,
    })
    if (missingFromDescription(input.description, corrective.foods).length < missing.length) {
      return corrective
    }
  } catch {
    /* 纠正重试失败不影响已有结果 */
  }
  return result
}

/** 演示模式：不联网，按本地食物库对文字描述做一次估算，返回同结构结果 */
async function demoAnalysis(description: string, mealType: MealType): Promise<MealAnalysisResult> {
  const text = description.trim() || '一份家常便饭（演示数据：米饭 150g、鸡胸肉 100g、西兰花 100g）'
  const est = await estimateDiet(text, mealType)
  const foods: AnalysisFoodItem[] = est.items
    .filter((i) => i.matched)
    .map((i) => ({
      name: i.name,
      weight: i.grams,
      unit: 'g',
      calories: i.kcal,
      caloriesPer100g: i.grams > 0 ? Math.round((i.kcal / i.grams) * 100) : 0,
      confidence: 0.6,
      remark: '演示模式：来自本地食物库估算',
      protein: i.protein,
      carb: i.carb,
      fat: i.fat,
      fiber: i.fiber,
    }))
  if (!foods.length) {
    throw new Error('演示模式没有匹配到食物，请换更通用的说法（如「米饭」「鸡腿」），或到「我的助手」配置一个真实模型')
  }
  return {
    foods,
    totalCalories: foods.reduce((a, f) => a + f.calories, 0),
    analysisSummary: '演示模式结果：数据来自本机食物库估算，不是真实大模型分析。配置真实模型后可识别照片。',
    uncertainties: ['演示模式不做图片识别，仅供参考'],
    conflictWarnings: [],
    engine: 'demo',
    model: 'demo-nutrition-v1',
  }
}

/**
 * 统一入口：图片 + 文字描述 → 结构化热量分析。
 * 图片识别失败时自动降级纯文字分析；两者都失败才抛错。
 */
export async function analyzeMeal(input: {
  description: string
  mealType: MealType
  images: VisionImage[]
}): Promise<MealAnalysisResult> {
  const hasImages = input.images.length > 0

  if (!hasImages) {
    const llm = resolveLlm()
    if (llm.provider === 'demo') return demoAnalysis(input.description, input.mealType)
    const cfg = pickModel(false)
    if (!cfg) throw new Error('模型未配置，请到「我的助手」完成模型配置')
    return callWithCoverage({ ...cfg, mealType: input.mealType, description: input.description, images: [] })
  }

  // 有图片：优先视觉模型
  const visionCfg = pickModel(true)
  if (visionCfg) {
    try {
      return await callWithCoverage({ ...visionCfg, mealType: input.mealType, description: input.description, images: input.images })
    } catch (err) {
      // 视觉失败 → 降级纯文字，并把失败原因写进不确定因素
      const reason = err instanceof Error ? err.message : String(err)
      const textCfg = pickModel(false)
      if (!textCfg) throw err
      const result = await callWithCoverage({ ...textCfg, mealType: input.mealType, description: input.description, images: [] })
      result.engine = 'text-only'
      result.uncertainties.unshift(`照片未能参与分析（${reason.slice(0, 80)}），本次结果仅基于文字描述`)
      return result
    }
  }

  // 有图片但连主模型都没配置 → 直接报错
  const llm = resolveLlm()
  if (llm.provider === 'demo') return demoAnalysis(input.description, input.mealType)
  throw new Error('模型未配置，无法分析图片。请到「我的助手」完成模型配置，或只填写文字描述重试')
}
