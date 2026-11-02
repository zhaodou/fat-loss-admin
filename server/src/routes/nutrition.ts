/**
 * 每日饮食「描述 → 营养估算」接口
 * ---------------------------------------------------------------------------
 * POST /api/nutrition/estimate
 *   body: { text: string, mealType?: 'breakfast'|'lunch'|'dinner'|'snack' }
 *   → { items, totals, advice, mealKcalTarget, matchedCount }
 * 真正去打 Open Food Facts 开源接口（中文别名→英文检索词）+ 本地常见食材兜底表，
 * 每条结果标注数据来源（openfoodfacts / local / none）。
 */
import { Router } from 'express'
import { estimateDiet, recalculate } from '../services/nutrition'
import { MEAL_TYPES } from '../config'
import { asyncRoute, str } from './helpers'

export const nutritionRouter = Router()

nutritionRouter.post(
  '/nutrition/estimate',
  asyncRoute(async (req, res) => {
    const text = str(req.body?.text).trim()
    if (!text) throw new Error('请先输入一段饮食描述，例如：300g西红柿,100g大米饭，100g的鸡腿')
    const mealType = (MEAL_TYPES as readonly string[]).includes(req.body?.mealType) ? (req.body.mealType as any) : 'lunch'
    const result = await estimateDiet(text, mealType)
    res.json(result)
  }),
)

nutritionRouter.post(
  '/nutrition/recalculate',
  asyncRoute(async (req, res) => {
    const items = req.body?.items
    if (!Array.isArray(items) || !items.length) throw new Error('请提供要重新计算的食物列表')
    const mealType = (MEAL_TYPES as readonly string[]).includes(req.body?.mealType) ? (req.body.mealType as any) : 'lunch'
    const result = recalculate(items, mealType)
    res.json(result)
  }),
)
