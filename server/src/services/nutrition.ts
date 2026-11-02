/**
 * 每日饮食「描述 → 营养估算」服务
 * ---------------------------------------------------------------------------
 * 入口是用户写的一段自然语言，例如：
 *   "300g西红柿,100g大米饭，100g的鸡腿"
 * 流程：
 *   1. parseDescription：拆成 [{ name, grams }]
 *   2. 对每个食材 lookupNutrition：
 *      - 先查本地常见食材表（中国食物成分表常见值，兜底，保证稳定出数）
 *      - 同时打 Open Food Facts 开源接口（真正联网调用，中文别名→英文检索词）
 *      - OFF 有把握的匹配就用 OFF 的值，否则回落本地表；都没有则标记「未匹配」
 *   3. 汇总总热量 / 蛋白质 / 脂肪 / 碳水 / 膳食纤维
 *   4. buildAdvice：结合用户档案（TDEE、蛋白目标、摄入下限）给本餐建议
 *
 * 设计取舍：Open Food Facts 是全球最大的开源食物库，但中文通用食材覆盖不稳定、
 * 且公共接口偶尔限流。所以本地表是「兜底网」，OFF 是「实时补全」——两者都真实参与，
 * 每条结果都标注数据来源，UI 上也能看到。
 */
import { getSettings } from '../db'
import { calcBmr, round } from './energy'
import { ACTIVITY_LEVELS, MealType } from '../config'
import { getProfile } from './data'

export interface Nutri {
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
}

export interface ParsedItem {
  name: string
  grams: number
  /** 文本（如 AI 助手回复）中已直接给出的营养数值：存在时 estimateDiet 直接采用，不再查库重算 */
  explicit?: { kcal: number; protein: number; carb: number; fat: number; fiber: number }
}

export interface EstimateItem extends ParsedItem {
  matched: boolean
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  /** 数据来源：openfoodfacts=开源接口，local=本地营养库，ai=AI 分析值直接采用，none=未匹配，manual=用户手填 */
  source: 'openfoodfacts' | 'local' | 'ai' | 'none' | 'manual'
  note?: string
}

export interface EstimateResult {
  items: EstimateItem[]
  totals: Nutri
  advice: string[]
  /** 本餐建议摄入热量（基于用户档案估算），用于对比 */
  mealKcalTarget: number
  matchedCount: number
}

/* --------------------------- 本地常见食材表 --------------------------- */
/* 每 100 g 可食部：kcal / 蛋白质 g / 碳水 g / 脂肪 g / 膳食纤维 g
 * en 用于去 Open Food Facts 检索的英文词；unitGrams 是「个/只」这类计数单位对应的默认克数。 */
interface LocalFood extends Nutri {
  en: string
  aliases?: string[]
  unitGrams?: number
}

const LOCAL_FOODS: Record<string, LocalFood> = {
  // 主食 / 谷物
  米饭: { en: 'cooked rice', kcal: 116, protein: 2.6, carb: 25.9, fat: 0.3, fiber: 0.3, unitGrams: 150 },
  '大米饭': { en: 'cooked rice', kcal: 116, protein: 2.6, carb: 25.9, fat: 0.3, fiber: 0.3, unitGrams: 150 },
  '白米饭': { en: 'cooked rice', kcal: 116, protein: 2.6, carb: 25.9, fat: 0.3, fiber: 0.3, unitGrams: 150 },
  '糙米饭': { en: 'brown rice', kcal: 112, protein: 2.6, carb: 23.5, fat: 0.9, fiber: 1.6, unitGrams: 150 },
  '馒头': { en: 'steamed bun', kcal: 223, protein: 7, carb: 47, fat: 1.1, fiber: 1.3, unitGrams: 100 },
  '面条': { en: 'cooked noodles', kcal: 110, protein: 3.4, carb: 22, fat: 0.6, fiber: 1, unitGrams: 200 },
  '全麦面包': { en: 'whole wheat bread', kcal: 246, protein: 9, carb: 43, fat: 3.4, fiber: 6, unitGrams: 35 },
  '面包': { en: 'bread', kcal: 280, protein: 9, carb: 50, fat: 5, fiber: 3, unitGrams: 35 },
  '红薯': { en: 'sweet potato', kcal: 86, protein: 1.6, carb: 20.1, fat: 0.1, fiber: 3, unitGrams: 150 },
  '土豆': { en: 'potato', kcal: 77, protein: 2, carb: 17.2, fat: 0.1, fiber: 0.7, unitGrams: 150 },
  '马铃薯': { en: 'potato', kcal: 77, protein: 2, carb: 17.2, fat: 0.1, fiber: 0.7, unitGrams: 150 },
  '玉米': { en: 'corn', kcal: 112, protein: 4, carb: 22.8, fat: 1.2, fiber: 2.9, unitGrams: 150 },
  '燕麦片': { en: 'oat flakes', kcal: 377, protein: 13, carb: 66, fat: 6.7, fiber: 10, unitGrams: 40 },
  '小米粥': { en: 'millet porridge', kcal: 46, protein: 1.4, carb: 9.4, fat: 0.5, fiber: 0.4 },
  '包子': { en: 'baozi', kcal: 220, protein: 7, carb: 40, fat: 3, fiber: 1.5, unitGrams: 100 },
  '饺子': { en: 'dumpling', kcal: 200, protein: 8, carb: 28, fat: 6, fiber: 1.2, unitGrams: 100 },
  '油条': { en: 'fried dough stick', kcal: 388, protein: 6, carb: 51, fat: 18, fiber: 1 },
  '生米': { en: 'white rice', kcal: 346, protein: 7.4, carb: 77.2, fat: 0.8, fiber: 0.7, unitGrams: 100 },

  // 蛋白质 / 肉蛋奶
  '鸡胸肉': { en: 'chicken breast', kcal: 165, protein: 31, carb: 0, fat: 3.6, fiber: 0, unitGrams: 120 },
  '鸡腿肉': { en: 'chicken thigh', kcal: 181, protein: 20, carb: 0, fat: 11, fiber: 0, unitGrams: 100 },
  '鸡腿': { en: 'chicken thigh', kcal: 181, protein: 20, carb: 0, fat: 11, fiber: 0, unitGrams: 100 },
  '鸡肉': { en: 'chicken', kcal: 165, protein: 20, carb: 0, fat: 5, fiber: 0, unitGrams: 100 },
  '鸡蛋': { en: 'egg', kcal: 144, protein: 13.3, carb: 2.8, fat: 8.8, fiber: 0, unitGrams: 50 },
  '蛋白': { en: 'egg white', kcal: 52, protein: 11, carb: 0.7, fat: 0.2, fiber: 0, unitGrams: 33 },
  '瘦牛肉': { en: 'lean beef', kcal: 143, protein: 21.3, carb: 0, fat: 5.6, fiber: 0, unitGrams: 100 },
  '牛肉': { en: 'beef', kcal: 143, protein: 21.3, carb: 0, fat: 5.6, fiber: 0, unitGrams: 100 },
  '猪里脊': { en: 'pork tenderloin', kcal: 155, protein: 20.2, carb: 0.7, fat: 7.9, fiber: 0, unitGrams: 100 },
  '猪肉': { en: 'pork', kcal: 395, protein: 13.2, carb: 2.4, fat: 37, fiber: 0, unitGrams: 100 },
  '羊肉': { en: 'lamb', kcal: 118, protein: 20.5, carb: 0, fat: 3.9, fiber: 0, unitGrams: 100 },
  '三文鱼': { en: 'salmon', kcal: 208, protein: 20.4, carb: 0, fat: 13.4, fiber: 0, unitGrams: 100 },
  '鱼': { en: 'fish', kcal: 105, protein: 18.6, carb: 0, fat: 3.4, fiber: 0, unitGrams: 120 },
  '虾': { en: 'shrimp', kcal: 93, protein: 18.6, carb: 1, fat: 0.8, fiber: 0, unitGrams: 100 },
  '北豆腐': { en: 'firm tofu', kcal: 116, protein: 12.2, carb: 3, fat: 6.5, fiber: 0.5, unitGrams: 100 },
  '豆腐': { en: 'tofu', kcal: 81, protein: 8.1, carb: 3.8, fat: 4.8, fiber: 0.4, unitGrams: 100 },
  '豆浆': { en: 'soy milk', kcal: 31, protein: 3, carb: 1.2, fat: 1.6, fiber: 0.2, unitGrams: 250 },
  '牛奶': { en: 'milk', kcal: 54, protein: 3, carb: 3.4, fat: 3.2, fiber: 0, unitGrams: 250 },
  '酸奶': { en: 'yogurt', kcal: 72, protein: 3.3, carb: 4.7, fat: 3.2, fiber: 0, unitGrams: 200 },

  // 蔬菜
  '西红柿': { en: 'tomato', kcal: 18, protein: 0.9, carb: 3.9, fat: 0.2, fiber: 1.2, unitGrams: 150 },
  '番茄': { en: 'tomato', kcal: 18, protein: 0.9, carb: 3.9, fat: 0.2, fiber: 1.2, unitGrams: 150 },
  '黄瓜': { en: 'cucumber', kcal: 15, protein: 0.8, carb: 2.9, fat: 0.2, fiber: 0.5, unitGrams: 100 },
  '西兰花': { en: 'broccoli', kcal: 34, protein: 2.8, carb: 4.3, fat: 0.4, fiber: 1.6, unitGrams: 100 },
  '菠菜': { en: 'spinach', kcal: 23, protein: 2.9, carb: 2.8, fat: 0.4, fiber: 1.4, unitGrams: 100 },
  '白菜': { en: 'chinese cabbage', kcal: 17, protein: 1.5, carb: 3.2, fat: 0.1, fiber: 0.8, unitGrams: 100 },
  '生菜': { en: 'lettuce', kcal: 15, protein: 1.4, carb: 2.9, fat: 0.2, fiber: 0.6, unitGrams: 100 },
  '胡萝卜': { en: 'carrot', kcal: 39, protein: 1, carb: 8.8, fat: 0.2, fiber: 1.1, unitGrams: 100 },
  '茄子': { en: 'eggplant', kcal: 23, protein: 1.1, carb: 4.9, fat: 0.2, fiber: 1.3, unitGrams: 100 },
  '青椒': { en: 'bell pepper', kcal: 20, protein: 1, carb: 4.6, fat: 0.2, fiber: 1.7, unitGrams: 100 },
  '彩椒': { en: 'bell pepper', kcal: 20, protein: 1, carb: 4.6, fat: 0.2, fiber: 1.7, unitGrams: 100 },
  '洋葱': { en: 'onion', kcal: 40, protein: 1.1, carb: 8.1, fat: 0.1, fiber: 1.3, unitGrams: 100 },
  '蘑菇': { en: 'mushroom', kcal: 26, protein: 2.2, carb: 3.3, fat: 0.3, fiber: 1.3, unitGrams: 100 },
  '香菇': { en: 'shiitake mushroom', kcal: 26, protein: 2.2, carb: 3.3, fat: 0.3, fiber: 1.3, unitGrams: 100 },
  '南瓜': { en: 'pumpkin', kcal: 26, protein: 0.7, carb: 5.3, fat: 0.2, fiber: 0.8, unitGrams: 150 },
  '芹菜': { en: 'celery', kcal: 14, protein: 0.8, carb: 2.7, fat: 0.1, fiber: 0.9, unitGrams: 100 },
  '韭菜': { en: 'chinese chives', kcal: 26, protein: 2.4, carb: 3.2, fat: 0.3, fiber: 1.4, unitGrams: 100 },

  // 水果
  '苹果': { en: 'apple', kcal: 52, protein: 0.3, carb: 13.5, fat: 0.2, fiber: 1.2, unitGrams: 150 },
  '香蕉': { en: 'banana', kcal: 89, protein: 1.1, carb: 22, fat: 0.3, fiber: 1.2, unitGrams: 120 },
  '橙子': { en: 'orange', kcal: 47, protein: 0.9, carb: 11.1, fat: 0.1, fiber: 0.6, unitGrams: 150 },
  '葡萄': { en: 'grape', kcal: 43, protein: 0.5, carb: 10.3, fat: 0.2, fiber: 0.4, unitGrams: 100 },
  '西瓜': { en: 'watermelon', kcal: 30, protein: 0.6, carb: 7.2, fat: 0.1, fiber: 0.2, unitGrams: 200 },
  '梨': { en: 'pear', kcal: 44, protein: 0.4, carb: 11.1, fat: 0.2, fiber: 1.3, unitGrams: 150 },
  '草莓': { en: 'strawberry', kcal: 32, protein: 0.7, carb: 6.1, fat: 0.2, fiber: 1.1, unitGrams: 100 },
  '蓝莓': { en: 'blueberry', kcal: 57, protein: 0.7, carb: 14.5, fat: 0.3, fiber: 2.4, unitGrams: 100 },

  // 豆类 / 坚果 / 油脂
  '花生': { en: 'peanut', kcal: 567, protein: 25, carb: 16, fat: 49, fiber: 8, unitGrams: 30 },
  '核桃': { en: 'walnut', kcal: 654, protein: 15, carb: 14, fat: 65, fiber: 6, unitGrams: 20 },
  '杏仁': { en: 'almond', kcal: 579, protein: 21, carb: 21, fat: 50, fiber: 12, unitGrams: 20 },
  '植物油': { en: 'vegetable oil', kcal: 899, protein: 0, carb: 0, fat: 99.9, fiber: 0, unitGrams: 10 },
  '橄榄油': { en: 'olive oil', kcal: 899, protein: 0, carb: 0, fat: 99.9, fiber: 0, unitGrams: 10 },
  '花生油': { en: 'peanut oil', kcal: 899, protein: 0, carb: 0, fat: 99.9, fiber: 0, unitGrams: 10 },

  // 饮料 / 其他
  '可乐': { en: 'cola', kcal: 43, protein: 0, carb: 10.6, fat: 0, fiber: 0, unitGrams: 330 },
  '啤酒': { en: 'beer', kcal: 43, protein: 0.5, carb: 3.6, fat: 0, fiber: 0, unitGrams: 330 },
}

/* 计数单位 → 默认克数（没有食材专属 unitGrams 时兜底） */
const UNIT_GRAMS: Record<string, number> = {
  个: 50, 颗: 50, 只: 100, 枚: 50, 片: 30, 块: 50, 根: 100, 条: 100, 瓣: 5, 碗: 250, 杯: 200, 份: 100, 盘: 300, 把: 50, 串: 50, 袋: 100, 包: 100,
}

/** 把食物名归一化，去掉常见修饰词和空格 */
export function normalizeName(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/(大约|大概|约|左右|少许|适量|一些|一点|多的|少的|新鲜|熟|生|热的|冷的|凉拌|清炒|红烧|油炸|水煮|蒸|炒|烤)/g, '')
    .replace(/[（）()]/g, '')
    .trim()
}

/** 在本地表里查找（精确 → 子串，优先更长命中） */
export function findLocal(name: string): LocalFood | null {
  const key = normalizeName(name)
  if (LOCAL_FOODS[key]) return LOCAL_FOODS[key]
  // 子串：从长到短尝试，避免「饭」误伤「米饭」
  const keys = Object.keys(LOCAL_FOODS).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (key.includes(k) || k.includes(key)) return LOCAL_FOODS[k]
  }
  return null
}

/* ----------------------- Open Food Facts（开源接口） ----------------------- */

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/search'
const OFF_UA = 'FitPilot/1.0 (personal-ai-diet-tracker; contact: local@example.com)'
/** 结果缓存：英文词 → 营养值，TTL 6 小时，减少对公共接口的重复请求与限流影响 */
const offCache = new Map<string, { data: Nutri | null; ts: number }>()
const OFF_TTL = 6 * 3600 * 1000

function numOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pickBest(products: any[], term: string): Nutri | null {
  const cands = (products || []).filter((p) => {
    const n = p?.nutriments || {}
    const kcal = numOr(n['energy-kcal_100g'], numOr(n['energy_100g'], 0) / 4.184)
    return kcal > 0 && kcal < 900
  })
  if (!cands.length) return null
  const t = term.toLowerCase()
  cands.sort((a, b) => {
    const sa = ((a?.product_name || '').toLowerCase().includes(t) ? 1 : 0) + ((a?.categories || '').toLowerCase().includes(t) ? 1 : 0)
    const sb = ((b?.product_name || '').toLowerCase().includes(t) ? 1 : 0) + ((b?.categories || '').toLowerCase().includes(t) ? 1 : 0)
    return sb - sa
  })
  const n = cands[0].nutriments || {}
  const kcal = numOr(n['energy-kcal_100g'], numOr(n['energy_100g'], 0) / 4.184)
  return {
    kcal: Math.round(kcal),
    protein: Math.round(numOr(n['proteins_100g'], 0) * 10) / 10,
    carb: Math.round(numOr(n['carbohydrates_100g'], 0) * 10) / 10,
    fat: Math.round(numOr(n['fat_100g'], 0) * 10) / 10,
    fiber: Math.round(numOr(n['fiber_100g'], 0) * 10) / 10,
  }
}

/** 查询 Open Food Facts，按英文检索词。超时 / 出错都返回 null（交给本地表兜底）。 */
async function queryOff(term: string): Promise<Nutri | null> {
  const cached = offCache.get(term)
  if (cached && Date.now() - cached.ts < OFF_TTL) return cached.data
  const url = `${OFF_BASE}?search_terms=${encodeURIComponent(term)}&fields=code,product_name,categories,nutriments&page_size=5`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': OFF_UA, Accept: 'application/json' }, signal: controller.signal })
    if (!resp.ok) {
      offCache.set(term, { data: null, ts: Date.now() })
      return null
    }
    const json = (await resp.json()) as any
    const data = pickBest(json?.products || [], term)
    offCache.set(term, { data, ts: Date.now() })
    return data
  } catch {
    // 限流 / 网络失败：缓存 60 秒的 null，避免短时疯狂重试
    offCache.set(term, { data: null, ts: Date.now() - OFF_TTL + 60000 })
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 查单个食材的营养（每 100 g）。
 * 策略：OFF 实时优先，本地表兜底。返回来源标记。
 */
async function lookupNutrition(name: string): Promise<{ nutri: Nutri; source: 'openfoodfacts' | 'local' } | null> {
  const local = findLocal(name)
  const term = local?.en || name
  // 真正去打开源接口（即使本地有，也想尽量用实时数据；失败就回落）
  const off = await queryOff(term)
  if (off) return { nutri: off, source: 'openfoodfacts' }
  if (local) return { nutri: local, source: 'local' }
  return null
}

/* ------------------------------ 描述解析 ------------------------------ */

const SPLIT_RE = /[，,、;；\n\r]+/
const LEAD_RE = /^\s*(\d+(?:\.\d+)?)\s*(克|g|kg|公斤|千克|毫克|ml|毫升|个|颗|只|枚|片|块|根|条|瓣|碗|杯|份|盘|把|串|袋|包)?\s*(?:的)?\s*(.+?)\s*$/i
const TRAIL_RE = /^(.+?)\s*(\d+(?:\.\d+)?)\s*(克|g|kg|公斤|千克|毫克|ml|毫升|个|颗|只|枚|片|块|根|条|瓣|碗|杯|份|盘|把|串|袋|包)?\s*$/i
/** 纯重量单位（直接就是克），用于区分「个」这类计数单位 */
const WEIGHT_UNITS = new Set(['克', 'g', 'kg', '公斤', '千克', '毫克', 'ml', '毫升'])

/** 切片 / 分块单位：表示已经切分的小份（片、块、根、条、瓣…），不能套用整只食材的 unitGrams */
const SLICED_UNITS = new Set(['片', '块', '根', '条', '瓣', '丝', '段', '粒'])

/**
 * 从 AI 助手回复中提取「已分析好营养」的条目，格式（兼容加粗/全角括号/同一段文字里多条）：
 *   米饭(100g): 约116kcal（蛋白质2.6g，脂肪0.3g，碳水25.9g，纤维0.3g）
 * 命中条目直接采用其数值（kcal 必需，蛋白/脂肪/碳水/纤维缺省 0），
 * 其余对话性文字（「并记录为今天的午餐。」等）天然不会被当成食物。
 */
export function extractAiNutritionItems(text: string): ParsedItem[] {
  const raw = String(text || '')
  const items: ParsedItem[] = []
  // 名称里排除括号/冒号/常见标点，避免「分析上述饭菜的热量，米饭」这类前缀被粘进食物名
  const rowRe =
    /[*_]*([^*_\n（(:：，,。；;！!？?…\s]{1,24}?)[*_]*\s*[（(]\s*(\d+(?:\.\d+)?)\s*g[^）)]*[）)]\s*[*_]*\s*[:：]?\s*约?\s*(\d+(?:\.\d+)?)\s*kcal/gi
  const matches = [...raw.matchAll(rowRe)]
  matches.forEach((m, i) => {
    const name = m[1].trim().replace(/^[*_\-\s•·]+/, '').replace(/[*_\s]+$/, '')
    if (!name) return
    const grams = Number(m[2])
    const kcal = Number(m[3])
    if (!Number.isFinite(grams) || !Number.isFinite(kcal)) return
    // 营养明细取当前匹配结束到下一条目开始之间的文字（如「（蛋白质2.6g，脂肪0.3g…）」）
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index ?? raw.length : raw.length
    const window = raw.slice(start, end).slice(0, 80)
    const numOf = (re: RegExp): number => {
      const mm = window.match(re)
      return mm ? Number(mm[1]) : 0
    }
    items.push({
      name,
      grams,
      explicit: {
        kcal,
        protein: numOf(/蛋白[质]*[\s：:（(]*(\d+(?:\.\d+)?)/i),
        fat: numOf(/脂肪[\s：:（(]*(\d+(?:\.\d+)?)/i),
        carb: numOf(/碳水[化合物]*[\s：:（(]*(\d+(?:\.\d+)?)/i),
        fiber: numOf(/纤维[\s：:（(]*(\d+(?:\.\d+)?)/i),
      },
    })
  })
  return items
}

/** 对话性碎片：不是食物名，直接丢弃（句子标点 / 指令动词 / 过长文本） */
const JUNK_CHUNK_RE = /[。！？!?…]|分析|记录|计算|上述|以上|菜品|这餐|本餐|这顿|早餐|午餐|晚餐|加餐|今天|总计|合计|建议|帮我|请/
const MAX_FOOD_NAME_LEN = 16

function isJunkChunk(chunk: string): boolean {
  if (!chunk) return true
  if (JUNK_CHUNK_RE.test(chunk)) return true
  // 纯数字 / 标点碎片
  if (!/[\u4e00-\u9fa5a-zA-Z]/.test(chunk)) return true
  // 去掉重量表达后的剩余部分过长，说明是句子不是食物名
  const nameOnly = chunk.replace(/\d+(?:\.\d+)?\s*(克|g|kg|公斤|千克|毫克|ml|毫升|个|颗|只|枚|片|块|根|条|瓣|碗|杯|份|盘|把|串|袋|包)/gi, '')
  return nameOnly.length > MAX_FOOD_NAME_LEN
}

function toGrams(amount: number, unit: string | undefined, name: string): number {
  const u = (unit || '').toLowerCase()
  if (!u || u === '克' || u === 'g') return round(amount, 1)
  if (u === 'kg' || u === '公斤' || u === '千克') return round(amount * 1000, 1)
  if (u === '毫克') return round(amount / 1000, 2)
  if (u === 'ml' || u === '毫升') return round(amount, 1) // 液体约 1 g/ml
  if (WEIGHT_UNITS.has(u)) return round(amount, 1)
  // 切片 / 分块单位：例如「2 片土豆」应 ≈ 2×30g，不能按整土豆 150g/个 放大成 300g
  if (SLICED_UNITS.has(u)) {
    const per = UNIT_GRAMS[u] ?? 50
    return round(amount * per, 1)
  }
  // 其余计数单位（个、只、碗、杯…）：优先食材专属整份克数，否则通用兜底
  const local = findLocal(name)
  const per = local?.unitGrams ?? UNIT_GRAMS[u] ?? 50
  return round(amount * per, 1)
}

export function parseDescription(text: string): ParsedItem[] {
  const raw = String(text || '')
  // 优先提取 AI 已分析好的条目（如「米饭(100g): 约116kcal（蛋白质2.6g，脂肪0.3g，碳水25.9g，纤维0.3g）」）。
  // 命中则直接采用这些数值，绝不重新估算；同时天然跳过回复里的对话性文字。
  const aiItems = extractAiNutritionItems(raw)
  if (aiItems.length) return aiItems

  // 先把括号内的「说明性内容」整体去掉（如「100g卤菜（4个海带结，1片藕片，2片土豆片，50g鸭肠）」），
  // 避免括号里的成分被错误拆成独立项、并以整只单位放大重量；括号里通常只是对主料的解释。
  const cleaned = raw.replace(/[（(][^（）()]*[）)]/g, ' ')
  const chunks = cleaned
    .split(SPLIT_RE)
    .map((c) => c.trim())
    .filter(Boolean)
    // 过滤对话性句子碎片：带句末标点、太长、或含指令动词的都不是食物名
    .filter((c) => !isJunkChunk(c))
  const items: ParsedItem[] = []
  for (const chunk of chunks) {
    let amount = 100
    let unit: string | undefined
    let name = chunk
    const lead = LEAD_RE.exec(chunk)
    if (lead) {
      amount = Number(lead[1])
      unit = lead[2]
      name = lead[3]
    } else {
      const trail = TRAIL_RE.exec(chunk)
      if (trail) {
        name = trail[1]
        amount = Number(trail[2])
        unit = trail[3]
      }
    }
    const grams = toGrams(amount, unit, name)
    items.push({ name: normalizeName(name) || name, grams })
  }
  return items
}

/* ------------------------------ 饮食建议 ------------------------------ */

function buildAdvice(totals: Nutri, mealType: MealType, mealKcalTarget: number, profileGender: 'male' | 'female'): string[] {
  const tips: string[] = []
  const kcal = totals.kcal || 0
  if (kcal === 0) {
    return ['这顿还没解析出热量，检查一下食材名是否常见（如「西红柿」「鸡腿」「米饭」），或改用更通用的说法。']
  }

  const diff = kcal - mealKcalTarget
  if (diff > mealKcalTarget * 0.1) {
    tips.push(`本餐约 ${kcal} kcal，比建议的 ${mealKcalTarget} kcal 多了约 ${Math.round(diff)} kcal。下一餐适当减量，或加 20–30 分钟快走把它消化掉。`)
  } else if (diff < -mealKcalTarget * 0.3) {
    tips.push(`本餐约 ${kcal} kcal，明显低于建议的 ${mealKcalTarget} kcal，长期这样容易掉肌肉、越减越慢。下一餐补到接近目标更稳。`)
  } else {
    tips.push(`本餐 ${kcal} kcal，基本贴着建议的 ${mealKcalTarget} kcal，节奏不错，保持。`)
  }

  // 蛋白质
  const mealProteinTarget = Math.max(15, Math.round((profileGender === 'male' ? 1500 : 1200) * 0 + mealKcalTarget * 0.3 / 4))
  if (totals.protein > 0 && totals.protein < mealProteinTarget * 0.6) {
    const gap = Math.round(mealProteinTarget - totals.protein)
    tips.push(`蛋白质偏少（${totals.protein} g，本餐建议约 ${mealProteinTarget} g）。再加 1 个鸡蛋或 80 g 鸡胸肉，约补 ${gap} g 蛋白，更抗饿、保肌肉。`)
  }

  // 膳食纤维
  if (totals.fiber > 0 && totals.fiber < 5) {
    tips.push(`膳食纤维只有 ${totals.fiber} g（本餐建议 ≥ 8 g）。配一份 150 g 西兰花或半个西红柿，饱腹感会好很多。`)
  }

  // 三大营养素结构
  const pKcal = totals.protein * 4
  const cKcal = totals.carb * 4
  const fKcal = totals.fat * 9
  const base = pKcal + cKcal + fKcal || 1
  const pPct = Math.round((pKcal / base) * 100)
  const cPct = Math.round((cKcal / base) * 100)
  const fPct = Math.round((fKcal / base) * 100)
  if (cPct > 65) {
    tips.push(`碳水占了 ${cPct}%，比例偏高。减半勺主食、把空间留给蔬菜和蛋白，血糖更稳、不容易饿。`)
  }
  if (fPct > 38) {
    tips.push(`脂肪占了 ${fPct}%，偏多。留意炒菜用油和肥肉，换成蒸煮或少油快炒能省下一大截热量。`)
  }
  if (pPct >= 25 && fPct <= 35 && cPct <= 60) {
    tips.push(`营养结构比较均衡（蛋白 ${pPct}% / 碳水 ${cPct}% / 脂肪 ${fPct}%），这顿质量在线。`)
  }

  tips.push('营养数据来自 Open Food Facts 开源食物库（常见食材取本地权威值），均为估算，不能替代医学或营养师建议。')
  return tips
}

/* ------------------------------ 对外入口 ------------------------------ */

/* 本餐目标热量（估算 / 重算共用）：减脂按 TDEE×0.8 估算日摄入，再按餐次拆分 */
function mealTargetFor(mealType: MealType): { mealKcalTarget: number; gender: 'male' | 'female' } {
  const profile = getProfile()
  const settings = getSettings()
  const bmr = calcBmr(profile, settings, new Date()).bmr
  const activityFactor = ACTIVITY_LEVELS[settings.energy.activityLevel]?.factor ?? 1.3
  const tdee = Math.round(bmr * activityFactor)
  const floor = profile.gender === 'male' ? settings.energy.minIntakeMale : settings.energy.minIntakeFemale
  const intakeTarget = Math.max(floor, Math.round(tdee * 0.8))
  const share = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 }[mealType] ?? 0.3
  return { mealKcalTarget: Math.round(intakeTarget * share), gender: profile.gender }
}

/* 汇总总额（估算 / 重算共用） */
function sumTotals(items: EstimateItem[]): Nutri {
  const t = items.reduce(
    (acc, it) => ({
      kcal: acc.kcal + it.kcal,
      protein: acc.protein + it.protein,
      carb: acc.carb + it.carb,
      fat: acc.fat + it.fat,
      fiber: acc.fiber + it.fiber,
    }),
    { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 },
  )
  t.kcal = Math.round(t.kcal)
  t.protein = Math.round(t.protein * 10) / 10
  t.carb = Math.round(t.carb * 10) / 10
  t.fat = Math.round(t.fat * 10) / 10
  t.fiber = Math.round(t.fiber * 10) / 10
  return t
}

export async function estimateDiet(text: string, mealType: MealType): Promise<EstimateResult> {
  const parsed = parseDescription(text)
  const looked = await Promise.all(
    parsed.map((it) => (it.explicit ? Promise.resolve(null) : lookupNutrition(it.name))),
  )
  const items: EstimateItem[] = parsed.map((it, i) => {
    // AI / 文本已给出营养数值 → 直接采用，不重新计算
    if (it.explicit) {
      return {
        name: it.name,
        grams: it.grams,
        matched: true,
        kcal: Math.round(it.explicit.kcal),
        protein: it.explicit.protein,
        carb: it.explicit.carb,
        fat: it.explicit.fat,
        fiber: it.explicit.fiber,
        source: 'ai',
        note: 'AI 分析值直接采用',
      }
    }
    const res = looked[i]
    if (!res) {
      return { ...it, matched: false, kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, source: 'none', note: '未匹配到食物' }
    }
    const r = it.grams / 100
    return {
      ...it,
      matched: true,
      kcal: Math.round(res.nutri.kcal * r),
      protein: Math.round(res.nutri.protein * r * 10) / 10,
      carb: Math.round(res.nutri.carb * r * 10) / 10,
      fat: Math.round(res.nutri.fat * r * 10) / 10,
      fiber: Math.round(res.nutri.fiber * r * 10) / 10,
      source: res.source,
    }
  })

  const totals = sumTotals(items)
  const { mealKcalTarget, gender } = mealTargetFor(mealType)
  const advice = buildAdvice(totals, mealType, mealKcalTarget, gender)

  return {
    items,
    totals,
    advice,
    mealKcalTarget,
    matchedCount: items.filter((i) => i.matched).length,
  }
}

/**
 * 重新计算：用户为「未匹配」食物手动补录营养后，用完整列表（含手填项）重新汇总
 * 总额与饮食建议。只统计 matched===true 的项（已匹配 + 已采用手填），保证
 * 「表格里展示的 = 计入总热量的 = 最终记录的」三者一致。
 */
export interface RecalcItem {
  name: string
  grams: number
  matched?: boolean
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  source: 'openfoodfacts' | 'local' | 'ai' | 'none' | 'manual'
}

export function recalculate(items: RecalcItem[], mealType: MealType): EstimateResult {
  const clean: EstimateItem[] = (items || []).map((it) => ({
    name: String(it.name || '').trim() || '未命名',
    grams: Math.max(0, Number(it.grams) || 0),
    matched: Boolean(it.matched),
    kcal: Math.max(0, Number(it.kcal) || 0),
    protein: Math.max(0, Number(it.protein) || 0),
    carb: Math.max(0, Number(it.carb) || 0),
    fat: Math.max(0, Number(it.fat) || 0),
    fiber: Math.max(0, Number(it.fiber) || 0),
    source: it.source || 'none',
  }))
  const counted = clean.filter((i) => i.matched)
  const totals = sumTotals(counted)
  const { mealKcalTarget, gender } = mealTargetFor(mealType)
  const advice = buildAdvice(totals, mealType, mealKcalTarget, gender)
  return {
    items: clean,
    totals,
    advice,
    mealKcalTarget,
    matchedCount: counted.length,
  }
}
