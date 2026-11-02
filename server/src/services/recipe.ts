/**
 * 组合餐食（dish）计算
 * ---------------------------------------------------------------------------
 * 用户说的是「一片面包、两片火腿、一片芝士、一个煎鸡蛋」，
 * 不是「每 100 g 含多少千卡」。这里负责把这种描述翻译成营养数据：
 *
 *   1. 每个食材按 food_id 或名称定位到食材库；
 *   2. 份量支持「2 片」「1 个」「150 g」，单位换算交给 servings.ts；
 *   3. 逐行算营养再求和，同时给出「每 100 g」的营养（用于存进 foods 表，
 *      这样记录饮食时仍然只需要 food_id + 克数，历史快照逻辑完全不变）。
 */
import { db } from '../db'
import { resolveServings, toGrams } from './servings'

export interface RecipeItemInput {
  food_id?: number | null
  name?: string
  grams?: number | null
  units?: number | null
  unit?: string | null
}

export interface RecipeLine {
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
}

export interface Nutrients {
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
}

export interface RecipeResult {
  lines: RecipeLine[]
  total: Nutrients & { grams: number }
  per100: Nutrients
  unresolved: { name: string; reason: string }[]
  units_hint: { food_id: number; servings: { label: string; grams: number }[] }[]
}

const r1 = (v: number) => Math.round(v * 10) / 10

function emptyNutrients(): Nutrients {
  return { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 }
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
  kind: string
}

/** 名称匹配：精确 → 去括号 → 包含，都只找单一食材，避免餐食套餐食 */
export function findIngredient(name: string, allowDish = false): FoodRow | null {
  const clean = String(name ?? '').trim()
  if (!clean) return null
  const kindWhere = allowDish ? '' : `AND kind = 'ingredient'`
  const exact = db.prepare(`SELECT * FROM foods WHERE name = ? ${kindWhere}`).get(clean) as FoodRow | undefined
  if (exact) return exact

  const stripped = clean.replace(/[（(].*?[)）]/g, '').trim()
  if (stripped && stripped !== clean) {
    const hit = db
      .prepare(`SELECT * FROM foods WHERE name LIKE ? ${kindWhere} ORDER BY LENGTH(name) ASC LIMIT 1`)
      .get(`%${stripped}%`) as FoodRow | undefined
    if (hit) return hit
  }
  const contains = db
    .prepare(`SELECT * FROM foods WHERE (name LIKE ? OR ? LIKE '%' || name || '%') ${kindWhere} ORDER BY LENGTH(name) DESC LIMIT 1`)
    .get(`%${clean}%`, clean) as FoodRow | undefined
  return contains ?? null
}

function amountLabel(grams: number, units: number | null | undefined, unit: string | null | undefined): string {
  if (units && unit && unit !== '克') return `${units} ${unit}（约 ${grams} g）`
  return `${grams} g`
}

/**
 * 核心：把一组「食材 + 份量」算成营养。
 * 任何一项都允许只给 units + unit（如 2 片），也允许直接给 grams。
 */
export function buildRecipe(items: RecipeItemInput[]): RecipeResult {
  const lines: RecipeLine[] = []
  const unresolved: { name: string; reason: string }[] = []
  const unitsHint: RecipeResult['units_hint'] = []
  const total = { ...emptyNutrients(), grams: 0 }

  for (const raw of items ?? []) {
    const idOrName = raw.food_id ?? raw.name ?? ''
    const food = raw.food_id
      ? ((db.prepare(`SELECT * FROM foods WHERE id = ? AND kind = 'ingredient'`).get(Number(raw.food_id)) as FoodRow | undefined) ?? null)
      : findIngredient(String(raw.name ?? ''))

    if (!food) {
      unresolved.push({ name: String(raw.name ?? idOrName ?? '未命名食材'), reason: '食材库里没有匹配项，请先新增这个食材' })
      continue
    }

    const units = raw.units === null || raw.units === undefined || !Number.isFinite(Number(raw.units)) ? null : Number(raw.units)
    const unit = raw.unit ? String(raw.unit) : null

    let grams: number | null = null
    if (units !== null && unit) grams = toGrams(food, units, unit)
    if ((grams === null || grams <= 0) && raw.grams !== null && raw.grams !== undefined) grams = Number(raw.grams)
    if (grams === null || !Number.isFinite(grams) || grams <= 0) {
      // 什么都没给时按「1 份」兜底，比直接丢掉更符合直觉
      grams = Number(food.serving_g) || 100
    }

    const ratio = grams / 100
    const line: RecipeLine = {
      food_id: food.id,
      name: food.name,
      grams: r1(grams),
      units: units ?? null,
      unit: unit ?? null,
      amount_label: amountLabel(r1(grams), units, unit),
      kcal: Math.round(food.kcal * ratio),
      protein: r1(food.protein * ratio),
      carb: r1(food.carb * ratio),
      fat: r1(food.fat * ratio),
      fiber: r1(food.fiber * ratio),
    }
    lines.push(line)

    total.grams += line.grams
    total.kcal += line.kcal
    total.protein += line.protein
    total.carb += line.carb
    total.fat += line.fat
    total.fiber += line.fiber

    if (!unitsHint.some((u) => u.food_id === food.id)) {
      unitsHint.push({ food_id: food.id, servings: resolveServings(food).filter((u) => u.label !== '克') })
    }
  }

  const sum = {
    grams: r1(total.grams),
    kcal: Math.round(total.kcal),
    protein: r1(total.protein),
    carb: r1(total.carb),
    fat: r1(total.fat),
    fiber: r1(total.fiber),
  }

  const grams = sum.grams || 1
  const per100: Nutrients = {
    kcal: Math.round((sum.kcal / grams) * 100),
    protein: r1((sum.protein / grams) * 100),
    carb: r1((sum.carb / grams) * 100),
    fat: r1((sum.fat / grams) * 100),
    fiber: r1((sum.fiber / grams) * 100),
  }

  return { lines, total: sum, per100, unresolved, units_hint: unitsHint }
}

/** 餐食统一归到「我的餐食」分类下，方便在食物库里找 */
export const DISH_CATEGORY = '我的餐食'

export interface DishPayload {
  name: string
  category?: string
  items: RecipeItemInput[]
  servings?: { label: string; grams: number }[]
  note?: string
}

/**
 * 落库为餐食：foods 表里 kcal/protein/... 存「每 100 g」，
 * serving_g 存「一份（整道菜）多少克」，serving_label 存「1 份 180 g」。
 * recipe 存组成明细，之后改配方可以一键重算。
 */
export function saveDish(payload: DishPayload, id?: number, opts?: { builtin?: boolean }): { id: number; recipe: RecipeResult } {
  const name = String(payload.name ?? '').trim()
  if (!name) throw new Error('请给这份餐食起个名字')
  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) throw new Error('至少要加一个食材')

  const result = buildRecipe(items)
  if (!result.lines.length) throw new Error('食材都没能在库里匹配上，请检查名称')

  const totalGram = result.total.grams || 100
  const servingLabel = `1 份 ${Math.round(totalGram)} g`
  const servings =
    Array.isArray(payload.servings) && payload.servings.length
      ? JSON.stringify(payload.servings.filter((s) => s && s.label && Number(s.grams) > 0))
      : JSON.stringify([{ label: '份', grams: Math.round(totalGram) }])

  const recipe = JSON.stringify(
    result.lines.map((l) => ({
      food_id: l.food_id,
      name: l.name,
      grams: l.grams,
      units: l.units,
      unit: l.unit,
    })),
  )

  if (id) {
    db.prepare(
      `UPDATE foods SET name = ?, category = ?, kcal = ?, protein = ?, carb = ?, fat = ?, fiber = ?,
        serving_g = ?, serving_label = ?, servings = ?, recipe = ?, note = ? WHERE id = ? AND kind = 'dish'`,
    ).run(
      name,
      String(payload.category ?? DISH_CATEGORY),
      result.per100.kcal,
      result.per100.protein,
      result.per100.carb,
      result.per100.fat,
      result.per100.fiber,
      Math.round(totalGram),
      servingLabel,
      servings,
      recipe,
      String(payload.note ?? ''),
      id,
    )
    return { id, recipe: result }
  }

  const info = db
    .prepare(
      `INSERT INTO foods (name, category, kcal, protein, carb, fat, fiber, sodium, unit, serving_g, serving_label, pinyin,
        is_builtin, created_at, kind, servings, recipe, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'g', ?, ?, '', ?, ?, 'dish', ?, ?, ?)`,
    )
    .run(
      name,
      String(payload.category ?? DISH_CATEGORY),
      result.per100.kcal,
      result.per100.protein,
      result.per100.carb,
      result.per100.fat,
      result.per100.fiber,
      Math.round(totalGram),
      servingLabel,
      opts?.builtin ? 1 : 0,
      new Date().toISOString(),
      servings,
      recipe,
      String(payload.note ?? ''),
    )
  return { id: Number(info.lastInsertRowid), recipe: result }
}

/** 读出餐食列表时把 recipe / servings 反序列化成对象，前端不用再 JSON.parse */
export function decorateDish(row: any) {
  if (!row) return row
  let items: any[] = []
  try {
    items = row.recipe ? JSON.parse(row.recipe) : []
  } catch {
    items = []
  }
  let servings: any[] = []
  try {
    servings = row.servings ? JSON.parse(row.servings) : []
  } catch {
    servings = []
  }
  return { ...row, items, servings, item_count: items.length, recipe: undefined }
}
