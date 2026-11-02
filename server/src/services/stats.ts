/**
 * 统计聚合：日 / 周 / 月 / 年
 * 所有区间统计口径统一为「按天先算能量账，再对天做汇总」，
 * 避免把不同天数的数据混在一起平均。
 */
import { db, getSettings } from '../db'
import { calcDailyEnergy, planDailyDeficit, round } from './energy'
import { getActiveGoal, getPlan, getProfile, toExerciseItems, weightOn } from './data'
import type { WorkoutRow } from './data'
import { diffDays, linearRegression, shiftDate, trendWeight, type DatePoint } from './trend'

export interface DailyStat {
  date: string
  intake: number
  tdee: number
  bmr: number
  neat: number
  exerciseKcal: number
  exerciseMin: number
  deficit: number
  weight: number | null
  hasDiet: boolean
  mealCount: number
}

interface RangeRaw {
  diet: Map<string, { kcal: number; protein: number; carb: number; fat: number; fiber: number; count: number }>
  workouts: Map<string, WorkoutRow[]>
  weights: Map<string, number>
}

function loadRange(start: string, end: string): RangeRaw {
  const dietRows = db
    .prepare(
      `SELECT date, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(carb) AS carb,
              SUM(fat) AS fat, SUM(fiber) AS fiber, COUNT(*) AS count
       FROM diet_entries WHERE date BETWEEN ? AND ? GROUP BY date`,
    )
    .all(start, end) as any[]
  const workoutRows = db
    .prepare('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY date ASC')
    .all(start, end) as WorkoutRow[]
  const weightRows = db
    .prepare('SELECT date, weight_kg FROM body_records WHERE date BETWEEN ? AND ? AND weight_kg IS NOT NULL')
    .all(start, end) as { date: string; weight_kg: number }[]

  const diet = new Map<string, any>()
  for (const r of dietRows) {
    diet.set(r.date, {
      kcal: r.kcal || 0,
      protein: r.protein || 0,
      carb: r.carb || 0,
      fat: r.fat || 0,
      fiber: r.fiber || 0,
      count: r.count || 0,
    })
  }
  const workouts = new Map<string, WorkoutRow[]>()
  for (const w of workoutRows) {
    const list = workouts.get(w.date) ?? []
    list.push(w)
    workouts.set(w.date, list)
  }
  const weights = new Map<string, number>()
  for (const w of weightRows) weights.set(w.date, w.weight_kg)

  return { diet, workouts, weights }
}

export function dailyStats(start: string, end: string): DailyStat[] {
  const profile = getProfile()
  const settings = getSettings()
  const goal = getActiveGoal()
  const raw = loadRange(start, end)
  const days = Math.max(0, diffDays(start, end))
  const out: DailyStat[] = []

  let carried = weightOn(start).weight_kg

  for (let i = 0; i <= days; i++) {
    const date = shiftDate(start, i)
    const d = raw.diet.get(date)
    const intake = d ? d.kcal : 0
    const w = raw.weights.get(date) ?? carried
    carried = w
    const workouts = raw.workouts.get(date) ?? []
    const probe = calcDailyEnergy({
      profile,
      settings,
      weightKg: w,
      exercises: toExerciseItems(workouts),
      intakeKcal: intake,
      date,
    })
    let planned = 0
    let energy = probe
    if (goal) {
      planned = planDailyDeficit(w, goal.target_weight, goal.target_date, date, probe.tdee, settings.energy).recommended
      energy = calcDailyEnergy({
        profile,
        settings,
        weightKg: w,
        exercises: toExerciseItems(workouts),
        intakeKcal: intake,
        plannedDeficit: planned,
        date,
      })
    }
    out.push({
      date,
      intake: Math.round(intake),
      tdee: energy.tdee,
      bmr: energy.bmrPortion,
      neat: energy.neatKcal,
      exerciseKcal: energy.exerciseKcal,
      exerciseMin: energy.exerciseMinutes,
      // 没有饮食记录的那天不存在“缺口”概念，记 0，避免把没记录的日子算成大缺口
      deficit: d && d.count > 0 ? energy.deficit : 0,
      weight: raw.weights.get(date) ?? null,
      hasDiet: !!d && d.count > 0,
      mealCount: d?.count ?? 0,
    })
  }
  return out
}

export interface RangeSummary {
  start: string
  end: string
  days: number
  loggedDays: number
  avgIntake: number
  avgTdee: number
  avgDeficit: number
  totalDeficit: number
  totalExerciseMin: number
  totalExerciseKcal: number
  workoutDays: number
  weightStart: number | null
  weightEnd: number | null
  weightChange: number | null
  protein: number
  carb: number
  fat: number
  macroRatio: { protein: number; carb: number; fat: number }
  goalCompletion: number
}

export function summarize(series: DailyStat[]): RangeSummary {
  const logged = series.filter((s) => s.hasDiet)
  const weightPoints: DatePoint[] = series.filter((s) => s.weight !== null).map((s) => ({ date: s.date, value: s.weight as number }))
  const totalDeficit = logged.reduce((s, d) => s + d.deficit, 0)
  const raw = loadRange(series[0]?.date ?? '', series[series.length - 1]?.date ?? '')
  const protein = [...raw.diet.values()].reduce((s, d) => s + d.protein, 0)
  const carb = [...raw.diet.values()].reduce((s, d) => s + d.carb, 0)
  const fat = [...raw.diet.values()].reduce((s, d) => s + d.fat, 0)
  const pKcal = protein * 4
  const cKcal = carb * 4
  const fKcal = fat * 9
  const macroTotal = pKcal + cKcal + fKcal || 1
  const avgDeficit = logged.length ? totalDeficit / logged.length : 0

  return {
    start: series[0]?.date ?? '',
    end: series[series.length - 1]?.date ?? '',
    days: series.length,
    loggedDays: logged.length,
    avgIntake: logged.length ? Math.round(logged.reduce((s, d) => s + d.intake, 0) / logged.length) : 0,
    avgTdee: series.length ? Math.round(series.reduce((s, d) => s + d.tdee, 0) / series.length) : 0,
    avgDeficit: Math.round(avgDeficit),
    totalDeficit: Math.round(totalDeficit),
    totalExerciseMin: series.reduce((s, d) => s + d.exerciseMin, 0),
    totalExerciseKcal: Math.round(series.reduce((s, d) => s + d.exerciseKcal, 0)),
    workoutDays: series.filter((d) => d.exerciseMin > 0).length,
    weightStart: weightPoints[0]?.value ?? null,
    weightEnd: weightPoints[weightPoints.length - 1]?.value ?? null,
    weightChange:
      weightPoints.length > 1
        ? round(weightPoints[weightPoints.length - 1].value - weightPoints[0].value, 1)
        : null,
    protein: Math.round(protein),
    carb: Math.round(carb),
    fat: Math.round(fat),
    macroRatio: {
      protein: Math.round((pKcal / macroTotal) * 100),
      carb: Math.round((cKcal / macroTotal) * 100),
      fat: Math.round((fKcal / macroTotal) * 100),
    },
    goalCompletion: Math.round((avgDeficit / 400) * 100),
  }
}

export interface Bucket {
  key: string
  label: string
  start: string
  end: string
  avgIntake: number
  avgTdee: number
  avgDeficit: number
  weightEnd: number | null
  weightChange: number | null
  exerciseMin: number
  workoutDays: number
  loggedDays: number
}

export type Granularity = 'day' | 'week' | 'month'

export function bucketize(series: DailyStat[], granularity: Granularity): Bucket[] {
  const groups = new Map<string, DailyStat[]>()
  for (const d of series) {
    let key = d.date
    if (granularity === 'week') {
      const wd = new Date(`${d.date}T00:00:00`).getDay()
      const monday = shiftDate(d.date, -((wd + 6) % 7))
      key = monday
    } else if (granularity === 'month') {
      key = d.date.slice(0, 7)
    }
    const list = groups.get(key) ?? []
    list.push(d)
    groups.set(key, list)
  }

  return [...groups.entries()].map(([key, list]) => {
    const logged = list.filter((d) => d.hasDiet)
    const weights = list.filter((d) => d.weight !== null)
    const first = weights[0]?.weight ?? null
    const last = weights[weights.length - 1]?.weight ?? null
    const label =
      granularity === 'month'
        ? `${Number(key.slice(5, 7))} 月`
        : granularity === 'week'
          ? `${key.slice(5).replace('-', '/')} 周`
          : key.slice(5).replace('-', '/')
    return {
      key,
      label,
      start: list[0].date,
      end: list[list.length - 1].date,
      avgIntake: logged.length ? Math.round(logged.reduce((s, d) => s + d.intake, 0) / logged.length) : 0,
      avgTdee: Math.round(list.reduce((s, d) => s + d.tdee, 0) / list.length),
      avgDeficit: logged.length ? Math.round(logged.reduce((s, d) => s + d.deficit, 0) / logged.length) : 0,
      weightEnd: last,
      weightChange: first !== null && last !== null ? round(last - first, 1) : null,
      exerciseMin: list.reduce((s, d) => s + d.exerciseMin, 0),
      workoutDays: list.filter((d) => d.exerciseMin > 0).length,
      loggedDays: logged.length,
    }
  })
}

/** 周/月/年页面统一入口 */
export function getStatsReport(granularity: 'week' | 'month' | 'year', anchor: string) {
  const d = new Date(`${anchor}T00:00:00`)
  let start: string
  let end = anchor
  let bucket: Granularity = 'day'

  if (granularity === 'week') {
    // 滚动近 7 天：避免"周一打开周报只有 1 天数据"
    start = shiftDate(anchor, -6)
    end = anchor
    bucket = 'day'
  } else if (granularity === 'month') {
    start = `${anchor.slice(0, 7)}-01`
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    end = `${anchor.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
    bucket = 'day'
  } else {
    start = `${anchor.slice(0, 4)}-01-01`
    end = `${anchor.slice(0, 4)}-12-31`
    bucket = 'month'
  }

  const series = dailyStats(start, end).filter((s) => s.date <= anchor)
  const summary = summarize(series)

  // 与上一个同长度区间对比
  const len = series.length
  const prevEnd = shiftDate(start, -1)
  const prevStart = shiftDate(prevEnd, -(len - 1))
  const prevSeries = dailyStats(prevStart, prevEnd)
  const prev = summarize(prevSeries)

  return {
    granularity,
    start,
    end,
    anchor,
    series,
    buckets: bucketize(series, bucket),
    summary,
    previous: prev,
    compare: {
      intake: summary.avgIntake - prev.avgIntake,
      deficit: summary.avgDeficit - prev.avgDeficit,
      exerciseMin: summary.totalExerciseMin - prev.totalExerciseMin,
      weightChange: (summary.weightChange ?? 0) - (prev.weightChange ?? 0),
    },
  }
}

/** 用于仪表盘的 7/30 天迷你趋势 */
export function recentTrend(endDate: string, days = 30) {
  const start = shiftDate(endDate, -(days - 1))
  const series = dailyStats(start, endDate)
  const points: DatePoint[] = series.filter((s) => s.weight !== null).map((s) => ({ date: s.date, value: s.weight as number }))
  const reg = linearRegression(points)
  return {
    series,
    points,
    trendWeight: trendWeight(points).value,
    weeklyChange: round(reg.slope * 7, 2),
  }
}
