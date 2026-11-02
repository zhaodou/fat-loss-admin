/**
 * 组合餐食（dish）接口
 * ---------------------------------------------------------------------------
 * 解决「用户只知道吃了什么食材，不知道营养成分」的问题：
 *   POST /api/dishes/preview  传食材清单 → 返回逐行营养 + 合计（不落库，用于实时预览）
 *   POST /api/dishes          保存成「我的餐食」，以后一秒钟记录
 *   POST /api/dishes/recognize 上传餐食照片 → 返回拆解好的食材草稿
 */
import { Router } from 'express'
import multer from 'multer'
import { db, nowIso } from '../db'
import { buildRecipe, decorateDish, saveDish, type RecipeItemInput } from '../services/recipe'
import { resolveServings } from '../services/servings'
import { recognizeDish, listTemplates } from '../services/recognizer'
import { asyncRoute, num, optionalNum, str } from './helpers'

export const dishRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })

function listDishes(keyword?: string, limit = 100) {
  const kw = String(keyword ?? '').trim()
  const rows = kw
    ? (db
        .prepare(`SELECT * FROM foods WHERE kind = 'dish' AND (name LIKE ? OR note LIKE ?) ORDER BY id DESC LIMIT ?`)
        .all(`%${kw}%`, `%${kw}%`, limit) as any[])
    : (db.prepare(`SELECT * FROM foods WHERE kind = 'dish' ORDER BY id DESC LIMIT ?`).all(limit) as any[])
  return rows.map(decorateDish)
}

dishRouter.get(
  '/dishes',
  asyncRoute((req, res) => {
    res.json(listDishes(str(req.query.keyword as string), Math.min(200, num(req.query.limit, 100) || 100)))
  }),
)

dishRouter.get(
  '/dishes/templates',
  asyncRoute((_req, res) => {
    res.json(listTemplates())
  }),
)

dishRouter.get(
  '/dishes/units/:foodId',
  asyncRoute((req, res) => {
    const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(Number(req.params.foodId)) as any
    if (!food) throw new Error('食材不存在')
    res.json({ food_id: food.id, name: food.name, serving_g: food.serving_g, servings: resolveServings(food) })
  }),
)

dishRouter.get(
  '/dishes/:id',
  asyncRoute((req, res) => {
    const row = db.prepare(`SELECT * FROM foods WHERE id = ? AND kind = 'dish'`).get(Number(req.params.id)) as any
    if (!row) throw new Error('餐食不存在')
    const dish = decorateDish(row)
    // 带上每个食材当前的单位表，前端编辑时可以直接切换「片 / 个 / 克」
    const detail = buildRecipe((dish.items ?? []) as RecipeItemInput[])
    res.json({ ...dish, computed: detail })
  }),
)

dishRouter.post(
  '/dishes/preview',
  asyncRoute((req, res) => {
    const items = (req.body?.items ?? []) as RecipeItemInput[]
    res.json(buildRecipe(items))
  }),
)

dishRouter.post(
  '/dishes',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const name = str(b.name).trim()
    if (!name) throw new Error('请给这份餐食起个名字')
    // 同名餐食直接更新配方，避免「自制三明治」存出一堆重复项
    const existing = db.prepare(`SELECT id FROM foods WHERE name = ? AND kind = 'dish'`).get(name) as { id: number } | undefined
    if (existing) {
      const saved = saveDish(
        { name, category: str(b.category, '我的餐食'), items: b.items ?? [], servings: b.servings, note: str(b.note) },
        existing.id,
      )
      res.json({ ok: true, id: saved.id, existed: true, computed: saved.recipe })
      return
    }
    const saved = saveDish({
      name,
      category: str(b.category, '我的餐食'),
      items: b.items ?? [],
      servings: b.servings,
      note: str(b.note),
    })
    res.json({ ok: true, id: saved.id, computed: saved.recipe })
  }),
)

dishRouter.put(
  '/dishes/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare(`SELECT * FROM foods WHERE id = ? AND kind = 'dish'`).get(id) as any
    if (!row) throw new Error('餐食不存在')
    const b = req.body ?? {}
    const saved = saveDish(
      {
        name: str(b.name, row.name),
        category: str(b.category, row.category),
        items: b.items ?? [],
        servings: b.servings,
        note: str(b.note, row.note ?? ''),
      },
      id,
    )
    res.json({ ok: true, id: saved.id, computed: saved.recipe })
  }),
)

dishRouter.delete(
  '/dishes/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare(`SELECT * FROM foods WHERE id = ? AND kind = 'dish'`).get(id) as any
    if (!row) throw new Error('餐食不存在')
    if (row.is_builtin) throw new Error('内置示例餐食不可删除，可以复制一份再改')
    db.prepare(`DELETE FROM foods WHERE id = ?`).run(id)
    res.json({ ok: true })
  }),
)

/**
 * 拍照识别：返回「这道菜由哪些食材组成 + 各自大概多少」的草稿。
 * 不写记录、不落餐食，用户确认后自己决定是存成餐食还是直接记一餐。
 */
dishRouter.post(
  '/dishes/recognize',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const file = req.file
    if (!file) throw new Error('没有收到图片')
    const mealType = str(req.body?.meal_type, 'lunch')
    const result = await recognizeDish({
      buffer: file.buffer,
      mime: file.mimetype,
      originalName: file.originalname,
      mealType: mealType as any,
    })
    res.json(result)
  }),
)

/** 快速把某个餐食按份数记进饮食（避免前端重复换算） */
dishRouter.post(
  '/dishes/:id/log',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const dish = db.prepare(`SELECT * FROM foods WHERE id = ? AND kind = 'dish'`).get(id) as any
    if (!dish) throw new Error('餐食不存在')
    const b = req.body ?? {}
    const date = str(b.date, new Date().toISOString().slice(0, 10))
    const mealType = str(b.meal_type, 'lunch')
    const servings = optionalNum(b.servings) ?? 1
    const grams = Math.round((Number(b.grams) || Number(dish.serving_g) * servings) * 10) / 10
    const ratio = grams / 100
    const info = db
      .prepare(
        `INSERT INTO diet_entries (date, meal_type, food_id, food_name, amount_g, kcal, protein, carb, fat, fiber, photo, source, food_kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'dish', 'dish', ?)`,
      )
      .run(
        date,
        mealType,
        dish.id,
        dish.name,
        grams,
        Math.round(dish.kcal * ratio),
        Math.round(dish.protein * ratio * 10) / 10,
        Math.round(dish.carb * ratio * 10) / 10,
        Math.round(dish.fat * ratio * 10) / 10,
        Math.round(dish.fiber * ratio * 10) / 10,
        nowIso(),
      )
    res.json({ ok: true, id: Number(info.lastInsertRowid), grams })
  }),
)
