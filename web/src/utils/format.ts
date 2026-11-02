export function localDate(d: Date = new Date()): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localDate(d)
}

export function weekday(date: string): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00`).getDay()]
}

export function prettyDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${Number(m)} 月 ${Number(d)} 日`
}

export function relativeDay(date: string): string {
  const today = localDate()
  if (date === today) return '今天'
  if (date === shift(today, -1)) return '昨天'
  if (date === shift(today, 1)) return '明天'
  return weekday(date)
}

export function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function signed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const s = v > 0 ? '+' : ''
  return `${s}${v.toFixed(digits)}`
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return `${Math.round(v)}%`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const MEAL_META: Record<string, { label: string; icon: string; hint: string; color: string }> = {
  breakfast: { label: '早餐', icon: '🍳', hint: '7:00 – 9:00', color: '#f59e0b' },
  lunch: { label: '午餐', icon: '🍚', hint: '12:00 – 13:00', color: '#12a37a' },
  dinner: { label: '晚餐', icon: '🥗', hint: '18:00 – 19:00', color: '#3b82f6' },
  snack: { label: '加餐', icon: '🍎', hint: '训练前后', color: '#a855f7' },
}

export const INTENSITY_LABEL: Record<string, string> = {
  low: '低强度',
  moderate: '中强度',
  high: '高强度',
}

export const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: '久坐办公',
  light: '轻度活动',
  moderate: '中度活动',
  active: '高强度活动',
}
