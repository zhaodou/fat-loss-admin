import { Router } from 'express'
import { db, getSettings, nowIso, saveSettings } from '../db'
import { getActiveGoal, getPlan, getProfile } from '../services/data'
import { bmi, bmiCategory, healthyWeightRange, recommendedTargetWeight, planDailyDeficit } from '../services/energy'
import { num, optionalNum, str, asyncRoute, today } from './helpers'
import { weightOn } from '../services/data'
import { buildDaySchedule } from '../services/schedule'
import { localDateStr } from '../services/trend'

export const coreRouter = Router()

/* -------------------------------- 个人资料 -------------------------------- */

coreRouter.get('/profile', (_req, res) => {
  const p = getProfile()
  res.json({
    ...p,
    bmi: bmi(p.weight_kg, p.height_cm),
    bmiCategory: bmiCategory(bmi(p.weight_kg, p.height_cm)),
    healthyRange: healthyWeightRange(p.height_cm),
  })
})

coreRouter.put(
  '/profile',
  asyncRoute((req, res) => {
    const p = getProfile()
    const b = req.body ?? {}
    db.prepare(
      `UPDATE profile SET nickname = ?, gender = ?, birth_date = ?, height_cm = ?, weight_kg = ?,
        body_fat_pct = ?, activity_note = ?, updated_at = ? WHERE id = 1`,
    ).run(
      str(b.nickname, p.nickname),
      b.gender === 'male' ? 'male' : 'female',
      str(b.birth_date, p.birth_date),
      num(b.height_cm, p.height_cm),
      num(b.weight_kg, p.weight_kg),
      optionalNum(b.body_fat_pct),
      str(b.activity_note, p.activity_note),
      nowIso(),
    )
    res.json({ ok: true, profile: getProfile() })
  }),
)

/* ---------------------------------- 计划 ---------------------------------- */

coreRouter.get('/plan', (_req, res) => {
  res.json(getPlan())
})

coreRouter.put(
  '/plan',
  asyncRoute((req, res) => {
    const p = getPlan()
    const b = req.body ?? {}
    db.prepare(
      `UPDATE plan SET work_start = ?, work_end = ?, lunch_start = ?, lunch_end = ?, meal_minutes = ?,
        dinner_time = ?, wake_time = ?, sleep_time = ?, workout_days = ?, preferred = ?, diet_pref = ?,
        step_goal = ?, note = ?, updated_at = ? WHERE id = 1`,
    ).run(
      str(b.work_start, p.work_start),
      str(b.work_end, p.work_end),
      str(b.lunch_start, p.lunch_start),
      str(b.lunch_end, p.lunch_end),
      num(b.meal_minutes, p.meal_minutes),
      str(b.dinner_time, p.dinner_time),
      str(b.wake_time, p.wake_time),
      str(b.sleep_time, p.sleep_time),
      JSON.stringify(Array.isArray(b.workout_days) ? b.workout_days : p.workout_days),
      JSON.stringify(Array.isArray(b.preferred) ? b.preferred : p.preferred),
      JSON.stringify(b.diet_pref ?? p.diet_pref),
      num(b.step_goal, p.step_goal),
      str(b.note, p.note),
      nowIso(),
    )
    res.json({ ok: true, plan: getPlan() })
  }),
)

/** 按作息算出的今日可用运动时段（不做完整 AI 分析，用于计划页/记录页实时预览） */
coreRouter.get(
  '/plan/schedule',
  asyncRoute((req, res) => {
    const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : today()
    const plan = getPlan()
    const weight = weightOn(date).weight_kg
    const weekday = new Date(`${date}T00:00:00`).getDay()
    const result = buildDaySchedule(plan, weight, date, {
      workoutDay: plan.workout_days.includes(weekday),
      preferStrength: plan.workout_days.indexOf(weekday) % 2 === 0,
    })
    res.json({ ...result, weight, workoutDay: plan.workout_days.includes(weekday) })
  }),
)

/* --------------------------------- 设置 ---------------------------------- */

coreRouter.get('/settings', (_req, res) => {
  res.json(getSettings())
})

coreRouter.put(
  '/settings',
  asyncRoute((req, res) => {
    const next = saveSettings(req.body ?? {})
    res.json({ ok: true, settings: next })
  }),
)

/* --------------------------------- 目标 ---------------------------------- */

coreRouter.get('/goals', (_req, res) => {
  const rows = db.prepare('SELECT * FROM goals ORDER BY id DESC').all()
  res.json(rows)
})

coreRouter.get('/goals/suggestion', (_req, res) => {
  const p = getProfile()
  const weight = weightOn(today()).weight_kg
  const settings = getSettings()
  const suggestion = recommendedTargetWeight(p.height_cm, weight, p.body_fat_pct)
  const range = healthyWeightRange(p.height_cm)
  const targetDate = new Date()
  const weeks = Math.max(4, Math.round(((weight - suggestion) * 7700) / (0.5 * 7700)))
  targetDate.setDate(targetDate.getDate() + weeks * 7)
  res.json({
    currentWeight: weight,
    bmi: bmi(weight, p.height_cm),
    bmiCategory: bmiCategory(bmi(weight, p.height_cm)),
    healthyRange: range,
    recommendedWeight: suggestion,
    suggestedDate: localDateStr(targetDate),
    suggestedWeekly: 0.5,
    dailyDeficit: planDailyDeficit(weight, suggestion, localDateStr(targetDate), today(), 1800, settings.energy),
  })
})

coreRouter.post(
  '/goals',
  asyncRoute((req, res) => {
    const p = getProfile()
    const b = req.body ?? {}
    const current = weightOn(today()).weight_kg
    const targetWeight = num(b.target_weight, recommendedTargetWeight(p.height_cm, current, p.body_fat_pct))
    const targetDate = str(b.target_date, localDateStr(new Date(Date.now() + 90 * 86400000)))
    if (targetWeight >= current) throw new Error('目标体重需要小于当前体重')
    db.prepare("UPDATE goals SET status = 'archived' WHERE status = 'active'").run()
    const info = db
      .prepare(
        `INSERT INTO goals (start_weight, target_weight, target_date, start_date, weekly_target, status, note, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(current, targetWeight, targetDate, today(), num(b.weekly_target, 0.5), str(b.note), nowIso())
    res.json({ ok: true, id: info.lastInsertRowid, goal: getActiveGoal() })
  }),
)

coreRouter.put(
  '/goals/:id',
  asyncRoute((req, res) => {
    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(Number(req.params.id)) as any
    if (!goal) throw new Error('目标不存在')
    const b = req.body ?? {}
    db.prepare(
      `UPDATE goals SET target_weight = ?, target_date = ?, weekly_target = ?, status = ?, note = ? WHERE id = ?`,
    ).run(
      num(b.target_weight, goal.target_weight),
      str(b.target_date, goal.target_date),
      num(b.weekly_target, goal.weekly_target),
      str(b.status, goal.status),
      str(b.note, goal.note),
      goal.id,
    )
    res.json({ ok: true, goal: getActiveGoal() })
  }),
)

coreRouter.delete(
  '/goals/:id',
  asyncRoute((req, res) => {
    db.prepare('DELETE FROM goals WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)

/* ------------------------------- 数据导入导出 ------------------------------ */

const TABLES = [
  'profile',
  'body_records',
  'foods',
  'exercises',
  'workouts',
  'diet_entries',
  'meal_photos',
  'goals',
  'plan',
  'advice_logs',
  'assistant_threads',
  'assistant_messages',
  'settings',
] as const

coreRouter.get('/data/export', (_req, res) => {
  const data: Record<string, unknown> = {}
  for (const table of TABLES) {
    data[table] = db.prepare(`SELECT * FROM ${table}`).all()
  }
  const payload = {
    app: 'fat-loss-admin',
    version: 1,
    exportedAt: nowIso(),
    data,
  }
  res.setHeader('Content-Disposition', `attachment; filename="fatloss-export-${today()}.json"`)
  res.json(payload)
})

coreRouter.post(
  '/data/import',
  asyncRoute((req, res) => {
    const body = req.body ?? {}
    const data = body.data ?? body
    const mode = body.mode === 'merge' ? 'merge' : 'replace'
    if (!data || typeof data !== 'object') throw new Error('导入文件格式不正确')

    const tableMap: Record<string, string[]> = {
      body_records: ['date', 'weight_kg', 'waist_cm', 'body_fat_pct', 'muscle_kg', 'note', 'created_at'],
      workouts: ['date', 'start_time', 'exercise_id', 'name', 'duration_min', 'intensity', 'met', 'kcal', 'distance_km', 'avg_hr', 'route', 'note', 'created_at'],
      diet_entries: ['date', 'meal_type', 'food_id', 'food_name', 'amount_g', 'kcal', 'protein', 'carb', 'fat', 'fiber', 'photo', 'source', 'created_at'],
      foods: ['name', 'category', 'kcal', 'protein', 'carb', 'fat', 'fiber', 'sodium', 'unit', 'serving_g', 'serving_label', 'pinyin', 'is_builtin', 'created_at'],
      exercises: ['name', 'category', 'met', 'intensity', 'icon', 'note', 'is_builtin', 'created_at'],
      goals: ['start_weight', 'target_weight', 'target_date', 'start_date', 'weekly_target', 'status', 'note', 'created_at'],
    }

    const run = db.transaction(() => {
      if (mode === 'replace') {
        for (const t of ['body_records', 'workouts', 'diet_entries', 'meal_photos', 'goals', 'advice_logs', 'assistant_messages', 'assistant_threads']) {
          db.prepare(`DELETE FROM ${t}`).run()
        }
        if (Array.isArray(data.foods) && data.foods.length) {
          db.prepare('DELETE FROM foods WHERE is_builtin = 0').run()
        }
      }
      for (const [table, columns] of Object.entries(tableMap)) {
        const rows = data[table]
        if (!Array.isArray(rows)) continue
        for (const row of rows) {
          const cols = columns.filter((c) => row[c] !== undefined)
          if (!cols.length) continue
          const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
          try {
            db.prepare(sql).run(...cols.map((c) => (typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c])))
          } catch {
            // 跳过重复/非法行，导入不因单行失败而中断
          }
        }
      }
      if (data.profile && Array.isArray(data.profile) && data.profile[0]) {
        const p = data.profile[0]
        db.prepare('UPDATE profile SET nickname = ?, gender = ?, birth_date = ?, height_cm = ?, weight_kg = ? WHERE id = 1').run(
          str(p.nickname, '我'),
          p.gender === 'male' ? 'male' : 'female',
          str(p.birth_date, '1995-01-01'),
          num(p.height_cm, 165),
          num(p.weight_kg, 60),
        )
      }
      if (data.settings && Array.isArray(data.settings)) {
        for (const s of data.settings) {
          if (!s?.key) continue
          db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(s.key, s.value)
        }
      }
    })
    run()
    res.json({ ok: true, mode })
  }),
)

coreRouter.post(
  '/data/reset',
  asyncRoute((req, res) => {
    const keepLibrary = req.body?.keepLibrary !== false
    const run = db.transaction(() => {
      for (const t of ['body_records', 'workouts', 'diet_entries', 'meal_photos', 'goals', 'advice_logs']) {
        db.prepare(`DELETE FROM ${t}`).run()
      }
      if (!keepLibrary) {
        db.prepare('DELETE FROM foods WHERE is_builtin = 0').run()
        db.prepare('DELETE FROM exercises WHERE is_builtin = 0').run()
      }
      db.prepare("DELETE FROM settings WHERE key = 'app'").run()
    })
    run()
    saveSettings({ demoSeeded: true })
    res.json({ ok: true, keepLibrary })
  }),
)
