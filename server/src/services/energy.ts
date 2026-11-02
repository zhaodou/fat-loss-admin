/**
 * 能量计算引擎
 * ---------------------------------------------------------------------------
 * 本文件是整个系统唯一可信的「热量口径」。前端不重复实现任何公式，只做展示。
 *
 * 三条硬规则（对应产品要求）：
 * 1) 热量缺口 = 总日消耗（TDEE）− 摄入，绝不能用「基础代谢 − 摄入」冒充缺口。
 * 2) TDEE 由三部分组成：基础代谢 + 日常活动（NEAT）+ 运动，运动时段从日常消耗中
 *    按分钟剔除后再单独计算，避免同 1 小时被算两次。
 * 3) 运动消耗按 MET 计算：kcal = MET × 3.5 × 体重(kg) ÷ 200 × 分钟。
 */
import {
  ACTIVITY_LEVELS,
  KCAL_PER_KG_FAT,
  type AppSettings,
  type EnergySettings,
} from '../config'
import { localDateStr } from './trend'

export interface ProfileLike {
  gender: 'male' | 'female'
  birth_date: string
  height_cm: number
  weight_kg: number
  body_fat_pct?: number | null
}

export interface ExerciseItem {
  name: string
  duration_min: number
  intensity: 'low' | 'moderate' | 'high'
  met: number
}

export interface DailyEnergy {
  date: string
  weightKg: number
  age: number
  bmr: number
  bmrFormula: string
  activityFactor: number
  activityLevel: string
  /** 运动总时长（分钟） */
  exerciseMinutes: number
  /** 运动消耗（MET 毛消耗） */
  exerciseKcal: number
  /** 非运动时段的基础代谢 */
  bmrPortion: number
  /** 日常活动额外消耗（NEAT） */
  neatKcal: number
  /** 总日消耗 */
  tdee: number
  intakeKcal: number
  /** 缺口 = TDEE − 摄入，正数代表在减脂 */
  deficit: number
  deficitRatio: number
  /** 计划的每日缺口 */
  plannedDeficit: number
  intakeFloor: number
  status: 'ok' | 'insufficient' | 'in_progress' | 'excess' | 'over_restrict'
  notes: string[]
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function fromMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function ageFromBirth(birthDate: string, at: Date = new Date()): number {
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return 30
  let age = at.getFullYear() - b.getFullYear()
  const before = at.getMonth() < b.getMonth() || (at.getMonth() === b.getMonth() && at.getDate() < b.getDate())
  if (before) age -= 1
  return Math.max(14, Math.min(90, age))
}

export function round(n: number, digits = 0): number {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 基础代谢：Mifflin-St Jeor（默认），体脂率已知时可用 Katch-McArdle */
export function calcBmr(profile: ProfileLike, settings: AppSettings, date = new Date()): { bmr: number; formula: string } {
  const age = ageFromBirth(profile.birth_date, date)
  const w = profile.weight_kg
  const h = profile.height_cm
  const mifflin =
    profile.gender === 'male' ? 10 * w + 6.25 * h - 5 * age + 5 : 10 * w + 6.25 * h - 5 * age - 161

  const bf = profile.body_fat_pct
  const katch = bf && bf > 3 && bf < 60 ? 370 + 21.6 * (w * (1 - bf / 100)) : null

  const mode = settings.energy.bmrFormula
  if (mode === 'katch' && katch) return { bmr: round(katch), formula: 'Katch-McArdle' }
  if (mode === 'mifflin' || !katch) return { bmr: round(mifflin), formula: 'Mifflin-St Jeor' }
  return { bmr: round(katch), formula: 'Katch-McArdle' }
}

/** MET 毛消耗，ACSM 公式 */
export function metKcal(met: number, weightKg: number, minutes: number): number {
  return (met * 3.5 * weightKg) / 200 * minutes
}

/** 单条运动：强度系数修正 MET 后计算消耗 */
export function exerciseKcal(item: ExerciseItem, weightKg: number, energy: EnergySettings): number {
  const factor = energy.intensityFactor[item.intensity] ?? 1
  return round(metKcal(item.met * factor, weightKg, item.duration_min))
}

export interface EnergyCalcInput {
  profile: ProfileLike
  settings: AppSettings
  /** 当天的体重（优先取当天/最近的体重记录） */
  weightKg?: number
  exercises?: ExerciseItem[]
  intakeKcal: number
  plannedDeficit?: number
  date: string
  at?: Date
}

/**
 * 计算某一天的能量账。
 * 运动时段不从「日常消耗」里剔除的话，那 1 小时会被算两遍 —— 这是很多减脂 App 的通病。
 */
export function calcDailyEnergy(input: EnergyCalcInput): DailyEnergy {
  const { settings, date } = input
  const weightKg = input.weightKg ?? input.profile.weight_kg
  const profile: ProfileLike = { ...input.profile, weight_kg: weightKg }
  const energy = settings.energy
  const { bmr, formula } = calcBmr(profile, settings, input.at ?? new Date(date))

  const factor = ACTIVITY_LEVELS[energy.activityLevel]?.factor ?? 1.3
  const exercises = input.exercises ?? []
  const exerciseMinutes = exercises.reduce((s, e) => s + e.duration_min, 0)
  const exerciseKcalTotal = exercises.reduce((s, e) => s + exerciseKcal(e, weightKg, energy), 0)

  const effectiveExercise = energy.deductExerciseBaseline ? Math.min(exerciseMinutes, 1440) : 0
  const nonExMinutes = 1440 - effectiveExercise
  const bmrPortion = bmr * (nonExMinutes / 1440)
  const neatKcal = bmr * (factor - 1) * (nonExMinutes / 1440)
  const tdee = bmrPortion + neatKcal + exerciseKcalTotal

  const intake = Math.max(0, input.intakeKcal)
  const deficit = tdee - intake
  const plannedDeficit = input.plannedDeficit ?? 0
  const intakeFloor =
    profile.gender === 'male' ? energy.minIntakeMale : energy.minIntakeFemale

  const notes: string[] = []
  let status: DailyEnergy['status'] = 'ok'
  const nowRef = input.at ?? new Date()
  const isToday = date === localDateStr(nowRef)
  const partialDay = isToday && nowRef.getHours() < 21
  if (intake <= 0) {
    status = 'insufficient'
    notes.push('今天还没有饮食记录，缺口暂按“未摄入”计算，不代表真实情况。')
  } else if (intake < intakeFloor && partialDay) {
    status = 'in_progress'
    notes.push('当前还没到睡前，晚餐/加餐可能尚未记录，缺口数字会随记录继续收窄。')
  } else if (intake < intakeFloor) {
    status = 'over_restrict'
    notes.push(`摄入 ${round(intake)} kcal 已低于安全下限 ${intakeFloor} kcal，长期如此会掉肌肉、降低代谢。`)
  } else if (deficit < 0) {
    status = 'excess'
    notes.push(`今天热量盈余 ${round(-deficit)} kcal，偶尔一次不影响大局，看 7 天平均更重要。`)
  }
  if (!energy.deductExerciseBaseline && exerciseMinutes > 0) {
    notes.push('当前设置未从日常消耗中剔除运动时段，运动消耗被重复计入，建议在系统设置里打开“运动时段不重复计算”。')
  }

  return {
    date,
    weightKg: round(weightKg, 1),
    age: ageFromBirth(profile.birth_date, input.at ?? new Date(date)),
    bmr,
    bmrFormula: formula,
    activityFactor: factor,
    activityLevel: energy.activityLevel,
    exerciseMinutes,
    exerciseKcal: round(exerciseKcalTotal),
    bmrPortion: round(bmrPortion),
    neatKcal: round(neatKcal),
    tdee: round(tdee),
    intakeKcal: round(intake),
    deficit: round(deficit),
    deficitRatio: tdee > 0 ? round(deficit / tdee, 3) : 0,
    plannedDeficit: round(plannedDeficit),
    intakeFloor,
    status,
    notes,
  }
}

/* --------------------------------- 目标 ---------------------------------- */

export function planDailyDeficit(
  currentWeight: number,
  targetWeight: number,
  targetDate: string,
  today: string,
  tdee: number,
  energy: EnergySettings,
): { required: number; recommended: number; daysLeft: number; predictedDate: string; feasible: boolean } {
  const daysLeft = Math.max(1, Math.round((new Date(targetDate).getTime() - new Date(today).getTime()) / 86400000))
  const required = ((currentWeight - targetWeight) * KCAL_PER_KG_FAT) / daysLeft
  const cap = Math.min(energy.maxDeficitKcal, tdee * energy.maxDeficitRatio)
  const recommended = clamp(required, 200, Math.max(200, cap))
  const predictedDays = Math.max(1, Math.ceil(((currentWeight - targetWeight) * KCAL_PER_KG_FAT) / Math.max(1, recommended)))
  const predicted = new Date(new Date(today).getTime() + predictedDays * 86400000)
  return {
    required: round(required),
    recommended: round(recommended),
    daysLeft,
    predictedDate: localDateStr(predicted),
    feasible: required <= cap,
  }
}

export function bmi(weightKg: number, heightCm: number): number {
  if (!heightCm) return 0
  return round(weightKg / (heightCm / 100) ** 2, 1)
}

export function bmiCategory(value: number): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' } {
  if (value < 18.5) return { label: '偏瘦', tone: 'warning' }
  if (value < 24) return { label: '正常', tone: 'success' }
  if (value < 28) return { label: '超重', tone: 'warning' }
  return { label: '肥胖', tone: 'danger' }
}

/** 中国成人健康体重区间（BMI 18.5–23.9） */
export function healthyWeightRange(heightCm: number): { min: number; max: number; ideal: number } {
  const h = heightCm / 100
  return { min: round(18.5 * h * h, 1), max: round(23.9 * h * h, 1), ideal: round(21.5 * h * h, 1) }
}

export function recommendedTargetWeight(heightCm: number, current: number, bodyFat?: number | null): number {
  const range = healthyWeightRange(heightCm)
  const base = bodyFat && bodyFat > 30 ? range.ideal : clamp(current - 3, range.min, range.max)
  return round(clamp(base, range.min, range.max), 1)
}
