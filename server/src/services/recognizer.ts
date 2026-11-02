/**
 * 餐食识别：从一张照片 / 一句话，得到「这道菜由哪些食材组成、各多少克」
 * ---------------------------------------------------------------------------
 * 这是本次改版的关键：过去是识别成「一份 300 g 的蛋炒饭，180 kcal/100g」，
 * 用户没法核对也没法调整。现在改成拆解成食材：
 *   蛋炒饭 → 米饭 200 g + 鸡蛋 2 个 + 胡萝卜 50 g + 食用油 10 g
 * 这样每一行都能改，改完营养自动重算，也能直接存成「我的餐食」下次复用。
 *
 * 两种引擎：
 *   - 本地启发式：内置常见家常菜谱库，离线可用、结果可复现，明确标注是「候选」
 *   - 视觉模型：配置 VISION_ENDPOINT / VISION_API_KEY 后启用，先判菜名再拆食材
 */
import { db } from '../db'
import type { MealType } from '../config'
import { toGrams } from './servings'

export interface RecognizedItem {
  food_id: number | null
  name: string
  grams: number
  units: number | null
  unit: string | null
  amount_label: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  confidence: number
}

export interface RecognitionResult {
  engine: 'heuristic' | 'vision-model'
  dish_name: string
  category: string
  items: RecognizedItem[]
  total: { grams: number; kcal: number; protein: number; carb: number; fat: number; fiber: number }
  candidates: { name: string; kcal: number; items: number }[]
  note: string
}

interface DishTemplateItem {
  food: string
  units?: number
  unit?: string
  grams?: number
  confidence?: number
}

interface DishTemplate {
  name: string
  category: string
  aliases: string[]
  meals: MealType[]
  items: DishTemplateItem[]
}

/** 常见家常菜「配方库」：既是识别的候选来源，也是用户组合录入时的快捷模板 */
export const DISH_LIBRARY: DishTemplate[] = [
  {
    name: '自制三明治',
    category: '快手',
    aliases: ['三明治', 'sandwich', '吐司夹蛋'],
    meals: ['breakfast', 'lunch'],
    items: [
      { food: '全麦面包', units: 2, unit: '片' },
      { food: '火腿片', units: 2, unit: '片' },
      { food: '奶酪', units: 1, unit: '片' },
      { food: '鸡蛋', units: 1, unit: '个' },
      { food: '生菜', grams: 30 },
      { food: '沙拉酱', units: 1, unit: '勺' },
    ],
  },
  {
    name: '番茄炒蛋盖饭',
    category: '家常菜',
    aliases: ['番茄炒蛋', '西红柿炒鸡蛋', '番茄鸡蛋饭'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '米饭（熟）', grams: 150 },
      { food: '鸡蛋', units: 2, unit: '个' },
      { food: '番茄', units: 1, unit: '个' },
      { food: '食用油', units: 1, unit: '勺' },
    ],
  },
  {
    name: '青椒肉丝盖饭',
    category: '家常菜',
    aliases: ['青椒肉丝', '辣椒炒肉', '肉丝盖饭'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '米饭（熟）', grams: 150 },
      { food: '猪里脊', grams: 100 },
      { food: '青椒', units: 1, unit: '个' },
      { food: '食用油', units: 1, unit: '勺' },
    ],
  },
  {
    name: '家常蛋炒饭',
    category: '家常菜',
    aliases: ['炒饭', '鸡蛋炒饭', '扬州炒饭', '蛋炒饭'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '米饭（熟）', grams: 200 },
      { food: '鸡蛋', units: 2, unit: '个' },
      { food: '胡萝卜', grams: 50 },
      { food: '食用油', units: 1, unit: '勺' },
    ],
  },
  {
    name: '鸡蛋拌面',
    category: '面食',
    aliases: ['拌面', '鸡蛋面', '葱油拌面'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '面条（熟）', units: 1, unit: '碗' },
      { food: '鸡蛋', units: 1, unit: '个' },
      { food: '生菜', grams: 50 },
      { food: '生抽', units: 1, unit: '勺' },
      { food: '食用油', grams: 5 },
    ],
  },
  {
    name: '鸡胸沙拉',
    category: '轻食',
    aliases: ['沙拉', '鸡肉沙拉', '减脂餐'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '鸡胸肉（熟）', grams: 120 },
      { food: '生菜', grams: 100 },
      { food: '番茄', grams: 100 },
      { food: '沙拉酱', units: 1, unit: '勺' },
    ],
  },
  {
    name: '燕麦牛奶碗',
    category: '早餐',
    aliases: ['燕麦', '牛奶燕麦', '隔夜燕麦'],
    meals: ['breakfast'],
    items: [
      { food: '燕麦片（干）', units: 1, unit: '份' },
      { food: '牛奶（全脂）', units: 1, unit: '杯' },
      { food: '蓝莓', grams: 50 },
    ],
  },
  {
    name: '宫保鸡丁盖饭',
    category: '家常菜',
    aliases: ['宫保鸡丁', '鸡丁饭'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '米饭（熟）', grams: 150 },
      { food: '鸡腿肉（去皮）', grams: 100 },
      { food: '花生', units: 1, unit: '把' },
      { food: '青椒', grams: 60 },
      { food: '食用油', units: 1, unit: '勺' },
    ],
  },
  {
    name: '麻婆豆腐盖饭',
    category: '家常菜',
    aliases: ['麻婆豆腐', '豆腐盖饭'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '米饭（熟）', grams: 150 },
      { food: '嫩豆腐', units: 1, unit: '盒' },
      { food: '猪里脊', grams: 50 },
      { food: '食用油', units: 1, unit: '勺' },
    ],
  },
  {
    name: '清炒时蔬配饭',
    category: '家常菜',
    aliases: ['炒青菜', '素菜饭', '清炒时蔬'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '米饭（熟）', grams: 150 },
      { food: '清炒时蔬', units: 1, unit: '份' },
    ],
  },
  {
    name: '猪肉水饺（10 个）',
    category: '面食',
    aliases: ['水饺', '饺子', '速冻饺子'],
    meals: ['lunch', 'dinner'],
    items: [{ food: '猪肉水饺', units: 10, unit: '个' }],
  },
  {
    name: '牛肉汉堡套餐',
    category: '快餐',
    aliases: ['汉堡', 'burger', '快餐'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '牛肉汉堡', units: 1, unit: '个' },
      { food: '可乐', units: 1, unit: '罐' },
    ],
  },
  {
    name: '拉面加蛋',
    category: '面食',
    aliases: ['拉面', '牛肉面', '兰州拉面'],
    meals: ['lunch', 'dinner'],
    items: [
      { food: '兰州拉面', units: 1, unit: '碗' },
      { food: '鸡蛋', units: 1, unit: '个' },
    ],
  },
]

function hash(buffer: Buffer, name: string): number {
  let h = 2166136261
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    h ^= buffer[i]
    h = Math.imul(h, 16777619)
  }
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return Math.abs(h)
}

interface FoodRow {
  id: number
  name: string
  category: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  serving_g: number
  serving_label: string | null
  servings: string
}

function foodByName(name: string): FoodRow | null {
  const row = db.prepare(`SELECT * FROM foods WHERE name = ? AND kind = 'ingredient'`).get(name) as FoodRow | undefined
  return row ?? null
}

function buildItem(food: FoodRow, grams: number, confidence: number, units: number | null, unit: string | null): RecognizedItem {
  const ratio = grams / 100
  const label = units && unit && unit !== '克' ? `${units} ${unit}（约 ${Math.round(grams)} g）` : `${Math.round(grams)} g`
  return {
    food_id: food.id,
    name: food.name,
    grams: Math.round(grams * 10) / 10,
    units,
    unit,
    amount_label: label,
    kcal: Math.round(food.kcal * ratio),
    protein: Math.round(food.protein * ratio * 10) / 10,
    carb: Math.round(food.carb * ratio * 10) / 10,
    fat: Math.round(food.fat * ratio * 10) / 10,
    fiber: Math.round(food.fiber * ratio * 10) / 10,
    confidence,
  }
}

function sumItems(items: RecognizedItem[]) {
  const total = { grams: 0, kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 }
  for (const it of items) {
    total.grams += it.grams
    total.kcal += it.kcal
    total.protein += it.protein
    total.carb += it.carb
    total.fat += it.fat
    total.fiber += it.fiber
  }
  return {
    grams: Math.round(total.grams),
    kcal: Math.round(total.kcal),
    protein: Math.round(total.protein * 10) / 10,
    carb: Math.round(total.carb * 10) / 10,
    fat: Math.round(total.fat * 10) / 10,
    fiber: Math.round(total.fiber * 10) / 10,
  }
}

/** 把一道菜谱模板展开成带克数的食材行，multiplier 用于「吃了一半 / 加了份量」 */
function expandTemplate(t: DishTemplate, multiplier = 1, jitter = 0): RecognizedItem[] {
  const items: RecognizedItem[] = []
  t.items.forEach((it, idx) => {
    const food = foodByName(it.food)
    if (!food) return
    const conf = Math.min(0.92, Math.round(((it.confidence ?? 0.6) + ((jitter >> idx) % 10) / 100) * 100) / 100)
    let grams: number
    if (it.units && it.unit) {
      const converted = toGrams(food, it.units, it.unit)
      grams = (converted ?? (Number(food.serving_g) || 100)) * multiplier
    } else {
      grams = Number(it.grams ?? food.serving_g ?? 100) * multiplier
    }
    items.push(buildItem(food, grams, conf, it.units ?? null, it.unit ?? null))
  })
  return items
}

function candidatesFor(mealType: MealType, limit = 5) {
  return DISH_LIBRARY.filter((d) => d.meals.includes(mealType))
    .slice(0, limit)
    .map((d) => {
      const items = expandTemplate(d)
      return { name: d.name, kcal: sumItems(items).kcal, items: items.length }
    })
}

function heuristic(buffer: Buffer, originalName: string, mealType: MealType): RecognitionResult {
  const h = hash(buffer, originalName)
  const pool = DISH_LIBRARY.filter((d) => d.meals.includes(mealType))
  const source = pool.length ? pool : DISH_LIBRARY
  const picked = source[h % source.length]
  const multiplier = 0.85 + ((h >> 5) % 30) / 100
  const items = expandTemplate(picked, multiplier, h)

  return {
    engine: 'heuristic',
    dish_name: picked.name,
    category: picked.category,
    items,
    total: sumItems(items),
    candidates: candidatesFor(mealType),
    note: `本地菜谱库估算：猜的是「${picked.name}」，已按常见做法拆成 ${items.length} 个食材。份量是估算值，请按实际吃的量调整后再记录。`,
  }
}

/**
 * 视觉模型：先让它说「这是什么菜」，再拆成食材。
 * 直接问「多少卡」模型会给一个无法核对的数字，拆成食材后用户才能改。
 */
async function vision(
  buffer: Buffer,
  mime: string,
  mealType: MealType,
): Promise<RecognitionResult | null> {
  const endpoint = process.env.VISION_ENDPOINT
  const apiKey = process.env.VISION_API_KEY
  if (!endpoint || !apiKey) return null
  const model = process.env.VISION_MODEL || 'gpt-4o-mini'

  const ingredients = db.prepare(`SELECT name FROM foods WHERE kind = 'ingredient' ORDER BY id`).all() as { name: string }[]
  const catalog = ingredients.map((f) => f.name).join('、')

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              '你是中式饮食营养师。请把照片里的餐食拆解成「食材 + 克数」，而不是直接给一个热量数字。',
              '只使用给定食材库中的名称。必须返回严格 JSON，不要任何解释：',
              '{"dish_name":"菜名","items":[{"name":"食材名","grams":数字}]}',
              '注意：主食按熟重估算；一盘炒菜请把食用油单独算一行（通常 8-12 g）。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `餐次：${mealType}。可用食材库：${catalog}。请拆解这张照片里的餐食。` },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
            ],
          },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (!resp.ok) return null
    const json: any = await resp.json()
    const text: string = json.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())

    const items: RecognizedItem[] = []
    for (const it of parsed.items ?? []) {
      const name = String(it.name ?? '').trim()
      const food = foodByName(name)
      if (!food) continue
      const grams = Number(it.grams) > 0 ? Number(it.grams) : Number(food.serving_g) || 100
      items.push(buildItem(food, grams, 0.82, null, null))
    }
    if (!items.length) return null

    return {
      engine: 'vision-model',
      dish_name: String(parsed.dish_name ?? '识别到的餐食'),
      category: '识别',
      items,
      total: sumItems(items),
      candidates: candidatesFor(mealType),
      note: `由视觉模型 ${model} 拆解为食材，请核对克数后记录。油和酱料经常被低估，注意检查。`,
    }
  } catch {
    return null
  }
}

/** 统一入口：先试视觉模型，失败/未配置就回退本地菜谱库 */
export async function recognizeDish(input: {
  buffer: Buffer
  mime: string
  originalName: string
  mealType: MealType
}): Promise<RecognitionResult> {
  const visionResult = await vision(input.buffer, input.mime, input.mealType)
  return visionResult ?? heuristic(input.buffer, input.originalName, input.mealType)
}

/**
 * 兼容旧接口：/api/diet/photo 仍按「食材列表」返回。
 * 现在多带了 fiber 与单位信息，字段结构向前兼容。
 */
export async function recognizePhoto(input: {
  buffer: Buffer
  originalName: string
  mime: string
  mealType: MealType
}): Promise<RecognitionResult> {
  return recognizeDish(input)
}

/** 给「按食材组合」界面用的快捷模板（前端可直接展示成「常吃搭配」） */
export function listTemplates() {
  return DISH_LIBRARY.map((d) => {
    const items = expandTemplate(d)
    return {
      name: d.name,
      category: d.category,
      aliases: d.aliases,
      items: items.map((i) => ({
        food_id: i.food_id,
        name: i.name,
        grams: i.grams,
        units: i.units,
        unit: i.unit,
      })),
      total: sumItems(items),
    }
  })
}
