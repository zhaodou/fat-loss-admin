/**
 * 饮食记录写操作（被「每日饮食」前端、整餐替换、助手自动记录三个入口共用）
 * 把插入逻辑收口到一处，保证「同一个数值只有一种来源、同一个落库路径」。
 */
import { db, nowIso } from '../db'
import { MEAL_TYPES } from '../config'
import { num, optionalNum, str } from '../routes/helpers'
import { normalizeName } from './nutrition'

export interface DietInsertItem {
  date?: string
  meal_type: string
  food_name: string
  amount_g: number
  kcal: number
  protein?: number
  carb?: number
  fat?: number
  fiber?: number
  source?: string
  food_kind?: string
  photo?: string | null
  food_id?: number | null
  /** 整餐录入时的原始描述；整餐编辑 / 助手记录都会带上，便于回看与重算 */
  raw_text?: string | null
  /** 估算依据：这一项的营养值从哪来的（助手对话算的 / 手动补的 / 食物库查的） */
  basis?: string | null
}

/** 一次性插入多条饮食记录（事务）。返回新插入行的 id 列表。 */
export function insertDietEntries(date: string, items: DietInsertItem[]): number[] {
  const stmt = db.prepare(
    `INSERT INTO diet_entries (date, meal_type, food_id, food_name, amount_g, kcal, protein, carb, fat, fiber, photo, source, food_kind, raw_text, basis, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const ids: number[] = []
  const run = db.transaction((rows: DietInsertItem[]) => {
    for (const it of rows) {
      const mealType = (MEAL_TYPES as readonly string[]).includes(it.meal_type) ? it.meal_type : 'snack'
      const info = stmt.run(
        str(it.date, date),
        mealType,
        optionalNum(it.food_id) ?? null,
        str(it.food_name, '自定义食物'),
        num(it.amount_g, 100),
        num(it.kcal),
        num(it.protein),
        num(it.carb),
        num(it.fat),
        num(it.fiber),
        it.photo ?? null,
        str(it.source, 'manual'),
        str(it.food_kind, 'ingredient'),
        it.raw_text ?? null,
        it.basis ?? null,
        nowIso(),
      )
      ids.push(Number(info.lastInsertRowid))
    }
  })
  run(items)
  return ids
}

/**
 * 写入一餐，但按「同日期 + 同餐次 + 同名（归一化后）」去重：
 * 若已存在同名记录，则用新值 UPDATE 它（后者为主，不重复累加）；不存在才 INSERT。
 * 同一批 rows 内部出现同名时，后者同样覆盖前者。
 * 返回所有受影响行（含被更新的旧行 id）的 id 列表，便于上层「撤销」时整批删除。
 * 用于「助手自动记录」：避免与每日饮食里已记录的同餐同食物叠加成两条。
 */
export function upsertDietEntriesByMeal(date: string, mealType: string, rows: DietInsertItem[]): number[] {
  const meal = (MEAL_TYPES as readonly string[]).includes(mealType) ? mealType : 'snack'

  // 现有同名映射：归一化名 → 最新 id（后者为主，保留 id 最大的）
  const existing = db
    .prepare('SELECT id, food_name FROM diet_entries WHERE date = ? AND meal_type = ?')
    .all(date, meal) as { id: number; food_name: string }[]
  const byName = new Map<string, number>()
  for (const e of existing) {
    const key = normalizeName(e.food_name)
    const prev = byName.get(key)
    if (prev === undefined || e.id > prev) byName.set(key, e.id)
  }

  const insertStmt = db.prepare(
    `INSERT INTO diet_entries (date, meal_type, food_id, food_name, amount_g, kcal, protein, carb, fat, fiber, photo, source, food_kind, raw_text, basis, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const updateStmt = db.prepare(
    `UPDATE diet_entries
     SET food_id = ?, food_name = ?, amount_g = ?, kcal = ?, protein = ?, carb = ?, fat = ?, fiber = ?,
         photo = ?, source = ?, food_kind = ?, raw_text = ?, basis = ?, created_at = ?
     WHERE id = ?`,
  )

  const ids: number[] = []
  const run = db.transaction((list: DietInsertItem[]) => {
    for (const it of list) {
      const key = normalizeName(it.food_name)
      const foodName = str(it.food_name, '自定义食物')
      const amount = num(it.amount_g, 100)
      const kcal = num(it.kcal)
      const protein = num(it.protein)
      const carb = num(it.carb)
      const fat = num(it.fat)
      const fiber = num(it.fiber)
      const photo = it.photo ?? null
      const source = str(it.source, 'manual')
      const foodKind = str(it.food_kind, 'ingredient')
      const raw = it.raw_text ?? null
      const basis = it.basis ?? null
      const ts = nowIso()

      const existId = byName.get(key)
      if (existId !== undefined) {
        // 后者为主：用助手 / 新记录的数据覆盖已有的同名记录
        updateStmt.run(optionalNum(it.food_id) ?? null, foodName, amount, kcal, protein, carb, fat, fiber, photo, source, foodKind, raw, basis, ts, existId)
        ids.push(existId)
      } else {
        const info = insertStmt.run(date, meal, optionalNum(it.food_id) ?? null, foodName, amount, kcal, protein, carb, fat, fiber, photo, source, foodKind, raw, basis, ts)
        const newId = Number(info.lastInsertRowid)
        ids.push(newId)
        byName.set(key, newId) // 同一批内后续同名项覆盖本条
      }
    }
  })
  run(rows)
  return ids
}

/** 删除指定日期 + 餐次的所有记录（整餐替换前先清空）。 */
export function clearDietMeal(date: string, mealType: string): number {
  const info = db
    .prepare('DELETE FROM diet_entries WHERE date = ? AND meal_type = ?')
    .run(date, mealType)
  return info.changes
}
