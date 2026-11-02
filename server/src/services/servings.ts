/**
 * 份量单位换算
 * ---------------------------------------------------------------------------
 * 现实里没人会说「我吃了 35 克面包」，只会说「一片面包」。
 * 所以每种食材都可以带一组「单位 → 克数」，例如：
 *   [{"label":"片","grams":35},{"label":"袋","grams":70}]
 *
 * 解析优先级：
 *   1. foods.servings（用户/内置显式配置，最准）
 *   2. 从 serving_label 反推（"1 片 35 g" → 片=35g）
 *   3. 按分类给一组默认单位（保证「一个苹果」「一碗饭」也能填）
 */
export interface ServingUnit {
  label: string
  grams: number
}

/** 分类默认单位：只在食材本身没配单位时兜底，用户可在编辑框里覆盖 */
export const DEFAULT_UNITS_BY_CATEGORY: Record<string, ServingUnit[]> = {
  主食: [
    { label: '碗', grams: 150 },
    { label: '份', grams: 150 },
  ],
  蛋白质: [
    { label: '份', grams: 100 },
    { label: '块', grams: 100 },
  ],
  乳品: [{ label: '杯', grams: 250 }],
  蔬菜: [{ label: '份', grams: 150 }],
  水果: [{ label: '个', grams: 150 }],
  坚果: [{ label: '把', grams: 15 }],
  饮品: [{ label: '杯', grams: 250 }],
  零食: [{ label: '份', grams: 30 }],
  快餐: [{ label: '份', grams: 200 }],
  调味: [{ label: '勺', grams: 10 }],
  其他: [{ label: '份', grams: 100 }],
}

const UNIT_ALIASES: Record<string, string> = {
  g: '克',
  gram: '克',
  ml: '毫升',
  '100g': '100 克',
}

export function normalizeUnit(unit: string): string {
  const u = String(unit || '').trim()
  return UNIT_ALIASES[u.toLowerCase()] ?? u
}

/** 从 "1 片 35 g" / "10 个 200 g" / "半块 100 g" 反推单位与单份克数 */
export function deriveUnitFromLabel(label: string): ServingUnit | null {
  if (!label) return null
  const m = label.match(/^\s*(\d+(?:\.\d+)?|半)\s*([^\d\s.]+)\s*([\d.]+)\s*(?:g|ml|克|毫升)\s*$/i)
  if (!m) return null
  const count = m[1] === '半' ? 0.5 : Number(m[1]) || 1
  const unit = m[2]
  if (!unit || unit === '克' || unit === '毫升') return null
  const grams = Number(m[3]) / count
  if (!Number.isFinite(grams) || grams <= 0) return null
  return { label: unit, grams: Math.round(grams * 10) / 10 }
}

function safeParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

export function parseServings(raw: unknown): ServingUnit[] {
  const list = safeParse<any[]>(raw, [])
  if (!Array.isArray(list)) return []
  return list
    .map((it) => ({
      label: String(it?.label ?? '').trim(),
      grams: Number(it?.grams),
    }))
    .filter((it) => it.label && Number.isFinite(it.grams) && it.grams > 0)
}

/**
 * 拿到一个食材可用的单位列表。
 * 自身配置 > serving_label 反推 > 分类默认。始终把「克」放在第一位。
 */
export function resolveServings(food: {
  servings?: unknown
  serving_label?: string | null
  serving_g?: number | null
  category?: string | null
}): ServingUnit[] {
  const own = parseServings(food.servings)
  const derived: ServingUnit[] = []
  if (!own.length) {
    const fromLabel = deriveUnitFromLabel(String(food.serving_label ?? ''))
    if (fromLabel) derived.push(fromLabel)
  }
  const base = own.length ? own : derived.length ? derived : DEFAULT_UNITS_BY_CATEGORY[String(food.category ?? '其他')] ?? DEFAULT_UNITS_BY_CATEGORY['其他']
  const dedup = new Map<string, ServingUnit>()
  for (const u of base) if (!dedup.has(u.label)) dedup.set(u.label, u)
  return [{ label: '克', grams: 1 }, ...dedup.values()]
}

/**
 * 把「2 片」换算成克。
 * 单位是「克」时直接返回数值；找不到单位时返回 null，由调用方决定是按 1 份算还是报错。
 */
export function toGrams(
  food: { servings?: unknown; serving_label?: string | null; serving_g?: number | null; category?: string | null },
  value: number,
  unit?: string | null,
): number | null {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return null
  const u = normalizeUnit(String(unit ?? '克'))
  if (!u || u === '克' || u === '毫升') return Math.round(v * 10) / 10
  const list = resolveServings(food)
  const hit = list.find((it) => it.label === u || it.label === String(unit ?? '').trim())
  if (hit) return Math.round(v * hit.grams * 10) / 10
  // 兜底：任何未登记的单位都按「1 份 = serving_g」理解，避免直接报错中断记录
  const serving = Number(food.serving_g) || 100
  return Math.round(v * serving * 10) / 10
}

/** 反向：克 → 最贴近的单位描述，用于列表里显示「约 2 片」 */
export function describeGrams(
  food: { servings?: unknown; serving_label?: string | null; serving_g?: number | null; category?: string | null },
  grams: number,
): string | null {
  const list = resolveServings(food).filter((it) => it.label !== '克')
  if (!list.length) return null
  const best = list.find((it) => grams >= it.grams * 0.6 && grams <= it.grams * 1.6)
  if (!best) return null
  const count = Math.round((grams / best.grams) * 10) / 10
  if (!Number.isFinite(count) || count <= 0) return null
  return `${count} ${best.label}`
}
