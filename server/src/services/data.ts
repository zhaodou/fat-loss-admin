/**
 * 数据访问 + 日维度聚合
 * 所有页面/建议都从这里取数，保证「同一个数字只有一个来源」。
 */
import { db, getSettings } from '../db'
import { MEAL_TYPES, type AppSettings, type MealType } from '../config'
import {
  calcDailyEnergy,
  planDailyDeficit,
  type DailyEnergy,
  type ExerciseItem,
  type ProfileLike,
} from './energy'
import type { DatePoint } from './trend'

export interface ProfileRow {
  id: number
  nickname: string
  gender: 'male' | 'female'
  birth_date: string
  height_cm: number
  weight_kg: number
  body_fat_pct: number | null
  activity_note: string
  created_at: string
  updated_at: string
}

export interface PlanRow {
  id: number
  work_start: string
  work_end: string
  lunch_start: string
  lunch_end: string
  meal_minutes: number
  dinner_time: string
  wake_time: string
  sleep_time: string
  workout_days: number[]
  preferred: string[]
  diet_pref: { style: string; avoid: string[]; likes: string[] }
  step_goal: number
  note: string
  updated_at: string
}

export interface GoalRow {
  id: number
  start_weight: number
  target_weight: number
  target_date: string
  start_date: string
  weekly_target: number
  status: string
  note: string
  created_at: string
}

export interface BodyRow {
  id: number
  date: string
  weight_kg: number | null
  waist_cm: number | null
  body_fat_pct: number | null
  muscle_kg: number | null
  note: string
  created_at: string
}

export interface WorkoutRow {
  id: number
  date: string
  start_time: string
  exercise_id: number | null
  name: string
  duration_min: number
  intensity: 'low' | 'moderate' | 'high'
  met: number
  kcal: number
  distance_km: number | null
  avg_hr: number | null
  route: string | null
  note: string
  created_at: string
}

export interface DietRow {
  id: number
  date: string
  meal_type: MealType
  food_id: number | null
  food_name: string
  amount_g: number
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  photo: string | null
  source: string
  raw_text?: string | null
  created_at: string
}

export interface FoodRow {
  id: number
  name: string
  category: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  sodium: number
  unit: string
  serving_g: number
  serving_label: string
  pinyin: string
  is_builtin: number
  created_at: string
}

export interface ExerciseRow {
  id: number
  name: string
  category: string
  met: number
  intensity: 'low' | 'moderate' | 'high'
  icon: string
  note: string
  is_builtin: number
  created_at: string
}

/* -------------------------------- profile -------------------------------- */

export function getProfile(): ProfileRow {
  return db.prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow
}

export function getPlan(): PlanRow {
  const row = db.prepare('SELECT * FROM plan WHERE id = 1').get() as any
  if (!row) throw new Error('plan 未初始化')
  const safe = <T>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T
    } catch {
      return fallback
    }
  }
  return {
    ...row,
    workout_days: safe<number[]>(row.workout_days, [1, 3, 5]),
    preferred: safe<string[]>(row.preferred, ['快走']),
    diet_pref: safe(row.diet_pref, { style: '中式家常', avoid: [], likes: [] }),
  }
}

export function getActiveGoal(): GoalRow | null {
  return (db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as GoalRow) ?? null
}

/* --------------------------------- body ---------------------------------- */

export function getBodyRecords(days = 365, endDate?: string): BodyRow[] {
  return db
    .prepare('SELECT * FROM body_records ORDER BY date ASC')
    .all()
    .filter((r: any) => (endDate ? r.date <= endDate : true))
    .slice(-days) as BodyRow[]
}

export function weightOn(date: string): { weight_kg: number; from: string; source: 'record' | 'carry' | 'profile' } {
  const exact = db.prepare('SELECT * FROM body_records WHERE date = ?').get(date) as BodyRow | undefined
  if (exact?.weight_kg) return { weight_kg: exact.weight_kg, from: exact.date, source: 'record' }
  const prev = db
    .prepare('SELECT * FROM body_records WHERE date <= ? AND weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1')
    .get(date) as BodyRow | undefined
  if (prev?.weight_kg) return { weight_kg: prev.weight_kg, from: prev.date, source: 'carry' }
  const profile = getProfile()
  return { weight_kg: profile.weight_kg, from: '基础资料', source: 'profile' }
}

export function weightSeries(days = 90, endDate?: string): DatePoint[] {
  return getBodyRecords(400, endDate)
    .filter((r) => r.weight_kg !== null)
    .slice(-days)
    .map((r) => ({ date: r.date, value: r.weight_kg as number }))
}

/* --------------------------------- diet ---------------------------------- */

export function getDietEntries(date: string): DietRow[] {
  return db.prepare('SELECT * FROM diet_entries WHERE date = ? ORDER BY created_at ASC').all(date) as DietRow[]
}

export interface DietTotals {
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  byMeal: Record<MealType, number>
  count: number
}

export function summarizeDiet(entries: DietRow[]): DietTotals {
  const byMeal = Object.fromEntries(MEAL_TYPES.map((m) => [m, 0])) as Record<MealType, number>
  const totals: DietTotals = { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, byMeal, count: entries.length }
  for (const e of entries) {
    totals.kcal += e.kcal
    totals.protein += e.protein
    totals.carb += e.carb
    totals.fat += e.fat
    totals.fiber += e.fiber
    if (byMeal[e.meal_type] !== undefined) byMeal[e.meal_type] += e.kcal
  }
  totals.kcal = Math.round(totals.kcal)
  totals.protein = Math.round(totals.protein)
  totals.carb = Math.round(totals.carb)
  totals.fat = Math.round(totals.fat)
  totals.fiber = Math.round(totals.fiber)
  for (const m of MEAL_TYPES) byMeal[m] = Math.round(byMeal[m])
  return totals
}

export function getMealPhotos(date: string): { meal_type: MealType; url: string; recognized: any }[] {
  const rows = db.prepare('SELECT * FROM meal_photos WHERE date = ?').all(date) as any[]
  return rows.map((r) => ({
    meal_type: r.meal_type,
    url: r.url,
    recognized: r.recognized ? JSON.parse(r.recognized) : null,
  }))
}

/* -------------------------------- workout -------------------------------- */

export function getWorkouts(date: string): WorkoutRow[] {
  return db.prepare('SELECT * FROM workouts WHERE date = ? ORDER BY start_time ASC').all(date) as WorkoutRow[]
}

export function toExerciseItems(rows: WorkoutRow[]): ExerciseItem[] {
  return rows.map((w) => ({
    name: w.name,
    duration_min: w.duration_min,
    intensity: w.intensity,
    met: w.met,
  }))
}

/* --------------------------------- energy -------------------------------- */

export interface DayContext {
  date: string
  profile: ProfileRow
  settings: AppSettings
  plan: PlanRow
  goal: GoalRow | null
  weight: { weight_kg: number; from: string; source: string }
  diet: DietRow[]
  dietTotals: DietTotals
  workouts: WorkoutRow[]
  energy: DailyEnergy
  plannedDeficit: number
}

export function getDayContext(date: string): DayContext {
  const profile = getProfile()
  const settings = getSettings()
  const plan = getPlan()
  const goal = getActiveGoal()
  const weight = weightOn(date)
  const diet = getDietEntries(date)
  const dietTotals = summarizeDiet(diet)
  const workouts = getWorkouts(date)

  // 先用一次估算拿到 TDEE，才能把「目标」换算成每日缺口
  const probe = calcDailyEnergy({
    profile,
    settings,
    weightKg: weight.weight_kg,
    exercises: toExerciseItems(workouts),
    intakeKcal: dietTotals.kcal,
    date,
  })

  let plannedDeficit = 0
  let energy = probe
  if (goal) {
    plannedDeficit = planDailyDeficit(
      weight.weight_kg,
      goal.target_weight,
      goal.target_date,
      date,
      probe.tdee,
      settings.energy,
    ).recommended
    energy = calcDailyEnergy({
      profile,
      settings,
      weightKg: weight.weight_kg,
      exercises: toExerciseItems(workouts),
      intakeKcal: dietTotals.kcal,
      plannedDeficit,
      date,
    })
  }

  return {
    date,
    profile,
    settings,
    plan,
    goal,
    weight,
    diet,
    dietTotals,
    workouts,
    energy,
    plannedDeficit,
  }
}

/** 某天的热量摄入（不分餐） */
export function intakeOn(date: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(kcal),0) AS k FROM diet_entries WHERE date = ?').get(date) as { k: number }
  return Math.round(row.k)
}

export function toProfileLike(p: ProfileRow, weightKg: number, bodyFat?: number | null): ProfileLike {
  return {
    gender: p.gender,
    birth_date: p.birth_date,
    height_cm: p.height_cm,
    weight_kg: weightKg,
    body_fat_pct: bodyFat ?? p.body_fat_pct,
  }
}
