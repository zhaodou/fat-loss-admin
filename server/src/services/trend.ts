/**
 * 体重趋势工具
 * 体重每天都会因为水分、盐分、排便、生理期上下浮动 0.5–2 kg，
 * 所以任何建议都必须基于「平滑后的趋势」，而不是两天的差值。
 */

export interface DatePoint {
  date: string
  value: number
}

export interface Regression {
  slope: number
  intercept: number
  r2: number
  n: number
}

export function dayNumber(date: string): number {
  return Math.round(new Date(`${date}T00:00:00`).getTime() / 86400000)
}

/** 本地日期字符串（不能用 toISOString，东八区会整体差一天） */
export function localDateStr(d: Date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

export function diffDays(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a)
}

/** 最小二乘线性回归，x 用「距首日天数」，slope 单位 kg/天 */
export function linearRegression(points: DatePoint[]): Regression {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: points[0]?.value ?? 0, r2: 0, n }
  const x0 = dayNumber(points[0].date)
  const xs = points.map((p) => dayNumber(p.date) - x0)
  const ys = points.map((p) => p.value)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx
  let ssTot = 0
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i]
    ssTot += (ys[i] - my) ** 2
    ssRes += (ys[i] - pred) ** 2
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, n }
}

/** 指数平滑：alpha 越小越平滑，默认 0.25 ≈ 看重近 7 天 */
export function ema(points: DatePoint[], alpha = 0.25): DatePoint[] {
  const out: DatePoint[] = []
  let prev: number | null = null
  for (const p of points) {
    prev = prev === null ? p.value : alpha * p.value + (1 - alpha) * prev
    out.push({ date: p.date, value: Math.round(prev * 10) / 10 })
  }
  return out
}

/** 趋势体重 = 平滑后的最后一个点 */
export function trendWeight(points: DatePoint[], alpha = 0.25): { value: number | null; series: DatePoint[] } {
  if (!points.length) return { value: null, series: [] }
  const series = ema(points, alpha)
  return { value: series[series.length - 1].value, series }
}

/** 取某段区间的记录 */
export function inRange(points: DatePoint[], start: string, end: string): DatePoint[] {
  return points.filter((p) => p.date >= start && p.date <= end)
}

export function average(points: DatePoint[]): number | null {
  if (!points.length) return null
  return Math.round((points.reduce((s, p) => s + p.value, 0) / points.length) * 10) / 10
}

export function minMax(points: DatePoint[]): { min: number; max: number; spread: number } {
  if (!points.length) return { min: 0, max: 0, spread: 0 }
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return { min, max, spread: Math.round((max - min) * 10) / 10 }
}

/** 预测 n 天后体重（基于线性趋势） */
export function forecast(points: DatePoint[], daysAhead: number): number | null {
  if (points.length < 3) return null
  const { slope, intercept } = linearRegression(points)
  const x0 = dayNumber(points[0].date)
  const x = dayNumber(points[points.length - 1].date) - x0 + daysAhead
  return Math.round((intercept + slope * x) * 10) / 10
}

/** 统一保留 1 位小数 */
export function r1(n: number | null | undefined): number {
  if (n === null || n === undefined || Number.isNaN(n)) return 0
  return Math.round(n * 10) / 10
}
