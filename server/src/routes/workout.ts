import { Router } from 'express'
import { db, getSettings, nowIso } from '../db'
import { getProfile, getWorkouts, weightOn } from '../services/data'
import { metKcal, round } from '../services/energy'
import { shiftDate } from '../services/trend'
import { asyncRoute, num, optionalNum, reqDate, str, today } from './helpers'

export const workoutRouter = Router()

/* --------------------------------- 运动库 -------------------------------- */

workoutRouter.get(
  '/exercises',
  asyncRoute((req, res) => {
    const keyword = str(req.query.keyword as string).trim()
    const category = str(req.query.category as string).trim()
    const where: string[] = []
    const params: unknown[] = []
    if (keyword) {
      where.push('(name LIKE ? OR note LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    if (category && category !== '全部') {
      where.push('category = ?')
      params.push(category)
    }
    const rows = db
      .prepare(`SELECT * FROM exercises ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY is_builtin DESC, id ASC`)
      .all(...params)
    res.json(rows)
  }),
)

workoutRouter.get('/exercises/categories', (_req, res) => {
  res.json(db.prepare('SELECT category, COUNT(*) AS count FROM exercises GROUP BY category ORDER BY count DESC').all())
})

workoutRouter.post(
  '/exercises',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    if (!str(b.name).trim()) throw new Error('运动名称不能为空')
    const info = db
      .prepare(
        `INSERT INTO exercises (name, category, met, intensity, icon, note, is_builtin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        str(b.name).trim(),
        str(b.category, '有氧'),
        num(b.met, 5),
        str(b.intensity, 'moderate'),
        str(b.icon, '🏃'),
        str(b.note),
        nowIso(),
      )
    res.json({ ok: true, id: info.lastInsertRowid })
  }),
)

workoutRouter.put(
  '/exercises/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM exercises WHERE id = ?').get(id) as any
    if (!row) throw new Error('运动不存在')
    const b = req.body ?? {}
    db.prepare('UPDATE exercises SET name = ?, category = ?, met = ?, intensity = ?, note = ? WHERE id = ?').run(
      str(b.name, row.name),
      str(b.category, row.category),
      num(b.met, row.met),
      str(b.intensity, row.intensity),
      str(b.note, row.note),
      id,
    )
    res.json({ ok: true })
  }),
)

workoutRouter.delete(
  '/exercises/:id',
  asyncRoute((req, res) => {
    const row = db.prepare('SELECT * FROM exercises WHERE id = ?').get(Number(req.params.id)) as any
    if (!row) throw new Error('运动不存在')
    if (row.is_builtin) throw new Error('内置运动不可删除')
    db.prepare('DELETE FROM exercises WHERE id = ?').run(row.id)
    res.json({ ok: true })
  }),
)

/* --------------------------------- 运动记录 ------------------------------- */

function computeKcal(met: number, minutes: number, intensity: string, weightKg: number): number {
  const settings = getSettings()
  const factor = (settings.energy.intensityFactor as any)[intensity] ?? 1
  return round(metKcal(met * factor, weightKg, minutes))
}

workoutRouter.get(
  '/workouts',
  asyncRoute((req, res) => {
    const date = str(req.query.date as string)
    if (date) {
      res.json({ date, items: getWorkouts(date) })
      return
    }
    const end = str(req.query.end, today())
    const start = str(req.query.start, shiftDate(end, -29))
    const rows = db.prepare('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY date DESC, start_time DESC').all(start, end)
    res.json({ start, end, items: rows })
  }),
)

workoutRouter.post(
  '/workouts/estimate',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const weight = num(b.weight, weightOn(str(b.date, today())).weight_kg)
    const list: any[] = Array.isArray(b.exercises) ? b.exercises : [b]
    const items = list.map((e) => ({
      name: str(e.name, '运动'),
      met: num(e.met, 5),
      minutes: num(e.duration_min, 30),
      intensity: str(e.intensity, 'moderate'),
      kcal: computeKcal(num(e.met, 5), num(e.duration_min, 30), str(e.intensity, 'moderate'), weight),
    }))
    res.json({ weight, items, totalKcal: items.reduce((s, i) => s + i.kcal, 0) })
  }),
)

workoutRouter.post(
  '/workouts',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const date = str(b.date, today())
    const weight = weightOn(date).weight_kg
    const met = num(b.met, 5)
    const minutes = num(b.duration_min, 30)
    const intensity = str(b.intensity, 'moderate')
    const kcal = b.kcal ? num(b.kcal) : computeKcal(met, minutes, intensity, weight)
    const info = db
      .prepare(
        `INSERT INTO workouts (date, start_time, exercise_id, name, duration_min, intensity, met, kcal, distance_km, avg_hr, sets, reps, weight_kg, route, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        date,
        str(b.start_time, '19:30'),
        optionalNum(b.exercise_id),
        str(b.name, '运动'),
        minutes,
        intensity,
        met,
        kcal,
        optionalNum(b.distance_km),
        optionalNum(b.avg_hr),
        optionalNum(b.sets),
        optionalNum(b.reps),
        optionalNum(b.weight_kg),
        b.route ? JSON.stringify(b.route) : null,
        str(b.note),
        nowIso(),
      )
    res.json({ ok: true, id: info.lastInsertRowid, kcal })
  }),
)

workoutRouter.put(
  '/workouts/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id) as any
    if (!row) throw new Error('记录不存在')
    const b = req.body ?? {}
    const met = num(b.met, row.met)
    const minutes = num(b.duration_min, row.duration_min)
    const intensity = str(b.intensity, row.intensity)
    const kcal = b.kcal ? num(b.kcal) : computeKcal(met, minutes, intensity, weightOn(str(b.date, row.date)).weight_kg)
    db.prepare(
      `UPDATE workouts SET date = ?, start_time = ?, name = ?, duration_min = ?, intensity = ?, met = ?, kcal = ?,
        distance_km = ?, avg_hr = ?, sets = ?, reps = ?, weight_kg = ?, route = ?, note = ? WHERE id = ?`,
    ).run(
      str(b.date, row.date),
      str(b.start_time, row.start_time),
      str(b.name, row.name),
      minutes,
      intensity,
      met,
      kcal,
      optionalNum(b.distance_km) ?? row.distance_km,
      optionalNum(b.avg_hr) ?? row.avg_hr,
      optionalNum(b.sets),
      optionalNum(b.reps),
      optionalNum(b.weight_kg),
      b.route !== undefined ? (b.route ? JSON.stringify(b.route) : null) : row.route,
      str(b.note, row.note),
      id,
    )
    res.json({ ok: true, kcal })
  }),
)

workoutRouter.delete(
  '/workouts/:id',
  asyncRoute((req, res) => {
    db.prepare('DELETE FROM workouts WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)

/** 近 N 天运动汇总：按类型、按周 */
workoutRouter.get(
  '/workouts/summary',
  asyncRoute((req, res) => {
    const days = num(req.query.days, 28)
    const end = str(req.query.end, today())
    const start = shiftDate(end, -(days - 1))
    const rows = db.prepare('SELECT * FROM workouts WHERE date BETWEEN ? AND ?').all(start, end) as any[]

    const byCategory = new Map<string, { minutes: number; kcal: number; count: number }>()
    // 记录里没挂 exercise_id 时，按名称反查分类，保证「类型分布」不会全落进「其他」
    const catByName = new Map(
      (db.prepare('SELECT name, category FROM exercises').all() as any[]).map((e) => [e.name, e.category]),
    )
    for (const r of rows) {
      const ex = r.exercise_id ? (db.prepare('SELECT category FROM exercises WHERE id = ?').get(r.exercise_id) as any) : null
      const key = ex?.category ?? catByName.get(r.name) ?? '其他'
      const cur = byCategory.get(key) ?? { minutes: 0, kcal: 0, count: 0 }
      cur.minutes += r.duration_min
      cur.kcal += r.kcal
      cur.count += 1
      byCategory.set(key, cur)
    }

    const weeks = new Map<string, { minutes: number; kcal: number; count: number }>()
    for (const r of rows) {
      const wd = new Date(`${r.date}T00:00:00`).getDay()
      const key = shiftDate(r.date, -((wd + 6) % 7))
      const cur = weeks.get(key) ?? { minutes: 0, kcal: 0, count: 0 }
      cur.minutes += r.duration_min
      cur.kcal += r.kcal
      cur.count += 1
      weeks.set(key, cur)
    }

    const profile = getProfile()
    res.json({
      start,
      end,
      total: {
        count: rows.length,
        minutes: rows.reduce((s: number, r: any) => s + r.duration_min, 0),
        kcal: rows.reduce((s: number, r: any) => s + r.kcal, 0),
        days: new Set(rows.map((r: any) => r.date)).size,
      },
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.kcal - a.kcal),
      byWeek: [...weeks.entries()].sort().map(([week, v]) => ({ week, ...v })),
      profile: { weight: profile.weight_kg },
    })
  }),
)
