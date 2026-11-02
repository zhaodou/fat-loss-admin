import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { db, getSettings, nowIso } from '../db'
import { MEAL_LABEL, UPLOAD_DIR, type MealType } from '../config'
import { getActiveGoal, getBodyRecords, getDayContext, getPlan, getProfile, weightOn, weightSeries } from '../services/data'
import { dailyStats, getStatsReport, recentTrend, summarize } from '../services/stats'
import { bmi, bmiCategory, planDailyDeficit, round } from '../services/energy'
import { generateAdvice } from '../services/advice'
import { linearRegression, forecast, shiftDate, trendWeight, average, minMax } from '../services/trend'
import { asyncRoute, num, optionalNum, reqDate, str, today } from './helpers'

export const insightsRouter = Router()

/* --------------------------------- 仪表盘 -------------------------------- */

function streakDays(date: string): number {
  let count = 0
  for (let i = 0; i < 400; i++) {
    const d = shiftDate(date, -i)
    const row = db.prepare('SELECT COUNT(*) AS c FROM diet_entries WHERE date = ?').get(d) as { c: number }
    if (row.c > 0) count++
    else if (i === 0) continue
    else break
  }
  return count
}

insightsRouter.get(
  '/dashboard',
  asyncRoute((req, res) => {
    const date = reqDate(req)
    const ctx = getDayContext(date)
    const profile = ctx.profile
    const settings = getSettings()
    const plan = getPlan()
    const goal = ctx.goal

    const trend = recentTrend(date, 30)
    const points14 = trend.points.filter((p) => p.date >= shiftDate(date, -13))
    const reg14 = linearRegression(points14)
    const week = summarize(dailyStats(shiftDate(date, -6), date))

    const targetIntake = Math.round(Math.max(ctx.energy.intakeFloor, ctx.energy.tdee - ctx.plannedDeficit))
    const completion = ctx.plannedDeficit > 0 ? Math.round((ctx.energy.deficit / ctx.plannedDeficit) * 100) : 0

    const adviceRow = db.prepare('SELECT date, score, headline, payload FROM advice_logs ORDER BY id DESC LIMIT 1').get() as any
    const lastAdvice = adviceRow
      ? {
          date: adviceRow.date,
          score: adviceRow.score,
          headline: adviceRow.headline,
          level: JSON.parse(adviceRow.payload).level,
        }
      : null

    res.json({
      date,
      profile: {
        nickname: profile.nickname,
        height: profile.height_cm,
        gender: profile.gender,
        age: Math.floor((Date.now() - new Date(profile.birth_date).getTime()) / (365.25 * 86400000)),
        bmi: bmi(ctx.weight.weight_kg, profile.height_cm),
        bmiCategory: bmiCategory(bmi(ctx.weight.weight_kg, profile.height_cm)),
      },
      weight: {
        current: ctx.weight.weight_kg,
        source: ctx.weight.source,
        from: ctx.weight.from,
        trend: trend.trendWeight,
        weeklyChange: round(reg14.slope * 7, 2),
        deltaFromTrend:
          ctx.weight.source === 'record' ? round(ctx.weight.weight_kg - (trend.trendWeight ?? ctx.weight.weight_kg), 1) : null,
        series: trend.points.slice(-14),
        range: minMax(trend.points.slice(-7)),
      },
      intake: {
        ...ctx.dietTotals,
        target: targetIntake,
        remaining: Math.round(targetIntake - ctx.dietTotals.kcal),
        completion: Math.round((ctx.dietTotals.kcal / Math.max(1, targetIntake)) * 100),
      },
      burn: {
        bmr: ctx.energy.bmrPortion,
        bmrFull: ctx.energy.bmr,
        neat: ctx.energy.neatKcal,
        exercise: ctx.energy.exerciseKcal,
        exerciseMinutes: ctx.energy.exerciseMinutes,
        tdee: ctx.energy.tdee,
        activityLevel: ctx.energy.activityLevel,
        activityFactor: ctx.energy.activityFactor,
        exerciseList: ctx.workouts,
      },
      deficit: {
        value: ctx.energy.deficit,
        planned: ctx.plannedDeficit,
        completion,
        ratio: ctx.energy.deficitRatio,
        status: ctx.energy.status,
        notes: ctx.energy.notes,
        floor: ctx.energy.intakeFloor,
        maxDeficit: Math.round(Math.min(settings.energy.maxDeficitKcal, ctx.energy.tdee * settings.energy.maxDeficitRatio)),
      },
      goal: goal
        ? {
            startWeight: goal.start_weight,
            targetWeight: goal.target_weight,
            targetDate: goal.target_date,
            daysLeft: Math.max(0, Math.round((new Date(goal.target_date).getTime() - new Date(date).getTime()) / 86400000)),
            remaining: round(ctx.weight.weight_kg - goal.target_weight, 1),
            progress: Math.round(
              Math.max(
                -50,
                Math.min(
                  120,
                  ((goal.start_weight - ctx.weight.weight_kg) / Math.max(0.1, goal.start_weight - goal.target_weight)) * 100,
                ),
              ),
            ),
            predictedDate: planDailyDeficit(ctx.weight.weight_kg, goal.target_weight, goal.target_date, date, ctx.energy.tdee, settings.energy)
              .predictedDate,
          }
        : null,
      week: {
        avgIntake: week.avgIntake,
        avgDeficit: week.avgDeficit,
        avgTdee: week.avgTdee,
        workoutDays: week.workoutDays,
        exerciseMin: week.totalExerciseMin,
        loggedDays: week.loggedDays,
        weightChange: week.weightChange,
      },
      meals: (['breakfast', 'lunch', 'dinner', 'snack'] as MealType[]).map((type) => ({
        type,
        label: MEAL_LABEL[type],
        kcal: ctx.dietTotals.byMeal[type],
        items: ctx.diet.filter((d) => d.meal_type === type).length,
      })),
      workouts: ctx.workouts,
      plan: {
        workStart: plan.work_start,
        workEnd: plan.work_end,
        lunchStart: plan.lunch_start,
        lunchEnd: plan.lunch_end,
        dinnerTime: plan.dinner_time,
        workoutDays: plan.workout_days,
      },
      streak: streakDays(date),
      advice: lastAdvice,
      units: settings.units,
      privacy: settings.privacy,
    })
  }),
)

/* ------------------------------- 体重与身体数据 ----------------------------- */

insightsRouter.get(
  '/body',
  asyncRoute((req, res) => {
    const days = num(req.query.days, 90)
    const end = str(req.query.end, today())
    const start = shiftDate(end, -(days - 1))
    const rows = db.prepare('SELECT * FROM body_records WHERE date BETWEEN ? AND ? ORDER BY date ASC').all(start, end)
    const profile = getProfile()
    const goal = getActiveGoal()
    const ideal = goal?.target_weight ?? round(21.5 * (profile.height_cm / 100) ** 2, 1)
    const healthyRange = { min: round(ideal - 2.5, 1), max: round(ideal + 2.5, 1), ideal }
    const series = weightSeries(days, end)
    const reg = linearRegression(series)
    const trend = trendWeight(series)
    res.json({
      start,
      end,
      records: rows,
      series,
      trendSeries: trend.series,
      trendWeight: trend.value,
      weeklyChange: round(reg.slope * 7, 2),
      r2: round(reg.r2, 2),
      forecast30: forecast(series, 30),
      stats: {
        ...minMax(series),
        average: average(series),
        count: series.length,
        bmi: series.length ? bmi(series[series.length - 1].value, profile.height_cm) : null,
      },
      healthyRange,
    })
  }),
)

insightsRouter.post(
  '/body',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const date = str(b.date, today())
    const existing = db.prepare('SELECT * FROM body_records WHERE date = ?').get(date) as any
    if (existing) {
      db.prepare('UPDATE body_records SET weight_kg = ?, waist_cm = ?, body_fat_pct = ?, muscle_kg = ?, note = ? WHERE id = ?').run(
        optionalNum(b.weight_kg) ?? existing.weight_kg,
        optionalNum(b.waist_cm) ?? existing.waist_cm,
        optionalNum(b.body_fat_pct) ?? existing.body_fat_pct,
        optionalNum(b.muscle_kg) ?? existing.muscle_kg,
        str(b.note, existing.note),
        existing.id,
      )
    } else {
      db.prepare(
        'INSERT INTO body_records (date, weight_kg, waist_cm, body_fat_pct, muscle_kg, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(date, optionalNum(b.weight_kg), optionalNum(b.waist_cm), optionalNum(b.body_fat_pct), optionalNum(b.muscle_kg), str(b.note), nowIso())
    }
    // 同步基础资料里的当前体重，方便没记录时的兜底
    const latest = weightOn(date)
    if (latest.weight_kg) {
      db.prepare('UPDATE profile SET weight_kg = ?, updated_at = ? WHERE id = 1').run(latest.weight_kg, nowIso())
    }
    res.json({ ok: true, record: db.prepare('SELECT * FROM body_records WHERE date = ?').get(date) })
  }),
)

insightsRouter.delete(
  '/body/:id',
  asyncRoute((req, res) => {
    db.prepare('DELETE FROM body_records WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)

/* ------------------------------- 体型照片 ------------------------------- */

const bodyPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })
const BODY_VIEWS = ['front', 'side', 'back'] as const

insightsRouter.get(
  '/body/photos',
  asyncRoute((req, res) => {
    const date = str(req.query.date)
    const start = str(req.query.start)
    const end = str(req.query.end)
    let rows: any[]
    if (date) {
      rows = db.prepare('SELECT * FROM body_photos WHERE date = ? ORDER BY view, id').all(date)
    } else if (start && end) {
      rows = db.prepare('SELECT * FROM body_photos WHERE date >= ? AND date <= ? ORDER BY date, view').all(start, end)
    } else {
      rows = db.prepare('SELECT * FROM body_photos ORDER BY date DESC, view').all()
    }
    res.json(rows)
  }),
)

insightsRouter.post(
  '/body/photo',
  bodyPhotoUpload.single('file'),
  asyncRoute((req, res) => {
    const file = req.file
    if (!file) throw new Error('没有收到图片')
    const view = (BODY_VIEWS as readonly string[]).includes(str(req.body?.view))
      ? (str(req.body.view) as (typeof BODY_VIEWS)[number])
      : 'front'
    const date = str(req.body?.date, today())

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    const filename = `${date}-body-${view}-${Date.now()}${ext}`
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer)

    const url = `/uploads/${filename}`
    const info = db
      .prepare('INSERT INTO body_photos (date, view, url, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(date, view, url, '', nowIso())
    res.json({ ok: true, id: info.lastInsertRowid, url, view, date })
  }),
)

insightsRouter.delete(
  '/body/photo/:id',
  asyncRoute((req, res) => {
    const row = db.prepare('SELECT * FROM body_photos WHERE id = ?').get(Number(req.params.id)) as any
    if (!row) throw new Error('照片不存在')
    const abs = path.join(UPLOAD_DIR, path.basename(row.url))
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
    db.prepare('DELETE FROM body_photos WHERE id = ?').run(row.id)
    res.json({ ok: true })
  }),
)

/* -------------------------------- 热量分析 ------------------------------- */

insightsRouter.get(
  '/analysis/energy',
  asyncRoute((req, res) => {
    const date = reqDate(req)
    const ctx = getDayContext(date)
    const settings = getSettings()
    const goal = getActiveGoal()
    const e = ctx.energy
    const t = ctx.dietTotals
    const macroKcal = { protein: t.protein * 4, carb: t.carb * 4, fat: t.fat * 9 }
    const macroTotal = macroKcal.protein + macroKcal.carb + macroKcal.fat || 1

    const settingsDeficit = Math.min(settings.energy.maxDeficitKcal, e.tdee * settings.energy.maxDeficitRatio)
    const plan = planDailyDeficit(
      ctx.weight.weight_kg,
      goal?.target_weight ?? ctx.weight.weight_kg,
      goal?.target_date ?? shiftDate(date, 90),
      date,
      e.tdee,
      settings.energy,
    )

    res.json({
      date,
      weight: { value: ctx.weight.weight_kg, source: ctx.weight.source, from: ctx.weight.from },
      formula: {
        bmr: ctx.profile.gender === 'male' ? '10×体重 + 6.25×身高 − 5×年龄 + 5' : '10×体重 + 6.25×身高 − 5×年龄 − 161',
        bmrName: e.bmrFormula,
        activityName: settings.energy.activityLevel,
        activityFactor: e.activityFactor,
        metFormula: 'kcal = MET × 3.5 × 体重(kg) ÷ 200 × 分钟',
      },
      breakdown: {
        bmrFull: e.bmr,
        bmrPortion: e.bmrPortion,
        neat: e.neatKcal,
        exercise: e.exerciseKcal,
        exerciseMinutes: e.exerciseMinutes,
        tdee: e.tdee,
        intake: e.intakeKcal,
        deficit: e.deficit,
        deficitRatio: e.deficitRatio,
      },
      exercises: ctx.workouts.map((w) => ({
        name: w.name,
        minutes: w.duration_min,
        intensity: w.intensity,
        met: w.met,
        kcal: w.kcal,
        start: w.start_time,
      })),
      macros: {
        protein: t.protein,
        carb: t.carb,
        fat: t.fat,
        fiber: t.fiber,
        kcal: t.kcal,
        ratio: {
          protein: Math.round((macroKcal.protein / macroTotal) * 100),
          carb: Math.round((macroKcal.carb / macroTotal) * 100),
          fat: Math.round((macroKcal.fat / macroTotal) * 100),
        },
        targetProtein: Math.round(ctx.weight.weight_kg * settings.energy.proteinPerKg),
      },
      target: {
        intake: Math.max(e.intakeFloor, Math.round(e.tdee - ctx.plannedDeficit)),
        plannedDeficit: ctx.plannedDeficit,
        floor: e.intakeFloor,
        maxDeficit: Math.round(settingsDeficit),
        recommendedDeficit: plan.recommended,
        requiredDeficit: plan.required,
      },
      notes: e.notes,
      plan,
    })
  }),
)

/* -------------------------------- 统计报表 ------------------------------- */

/** 统计页可能传 YYYY / YYYY-MM / YYYY-MM-DD，统一成区间末端的完整日期，且不超过今天 */
function normalizeAnchor(raw: string): string {
  const t = today()
  if (/^\d{4}$/.test(raw)) {
    const end = `${raw}-12-31`
    return end > t ? t : end
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const end = `${raw}-${String(lastDay).padStart(2, '0')}`
    return end > t ? t : end
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw > t ? t : raw
  return t
}

insightsRouter.get(
  '/stats',
  asyncRoute((req, res) => {
    const granularity = ['week', 'month', 'year'].includes(str(req.query.granularity)) ? (str(req.query.granularity) as 'week' | 'month' | 'year') : 'week'
    const date = normalizeAnchor(str(req.query.date, today()))
    const report = getStatsReport(granularity, date)
    const goal = getActiveGoal()
    res.json({
      ...report,
      goal: goal
        ? {
            targetWeight: goal.target_weight,
            targetDate: goal.target_date,
            startWeight: goal.start_weight,
            progress: Math.round(
              ((goal.start_weight - (report.summary.weightEnd ?? goal.start_weight)) /
                Math.max(0.1, goal.start_weight - goal.target_weight)) *
                100,
            ),
          }
        : null,
    })
  }),
)

/* --------------------------------- AI 顾问 -------------------------------- */

function saveAdvice(payload: ReturnType<typeof generateAdvice>) {
  db.prepare('INSERT INTO advice_logs (date, score, headline, payload, engine, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    payload.date,
    payload.score,
    payload.headline,
    JSON.stringify(payload),
    payload.engine,
    nowIso(),
  )
}

insightsRouter.post(
  '/advice',
  asyncRoute((req, res) => {
    const date = reqDate(req)
    const payload = generateAdvice(date)
    saveAdvice(payload)
    res.json(payload)
  }),
)

insightsRouter.get(
  '/advice/latest',
  asyncRoute((req, res) => {
    const date = str(req.query.date)
    const row = date
      ? ((db.prepare('SELECT * FROM advice_logs WHERE date = ? ORDER BY id DESC LIMIT 1').get(date) as any) ??
        (db.prepare('SELECT * FROM advice_logs ORDER BY id DESC LIMIT 1').get() as any))
      : (db.prepare('SELECT * FROM advice_logs ORDER BY id DESC LIMIT 1').get() as any)
    if (!row) {
      res.json(null)
      return
    }
    res.json({ ...JSON.parse(row.payload), id: row.id, createdAt: row.created_at })
  }),
)

insightsRouter.get('/advice/history', (_req, res) => {
  const rows = db.prepare('SELECT id, date, score, headline, engine, created_at FROM advice_logs ORDER BY id DESC LIMIT 30').all()
  res.json(rows)
})

/** 今日时间线：把饮食、运动、体重按时间合并，方便复盘 */
insightsRouter.get(
  '/timeline',
  asyncRoute((req, res) => {
    const date = reqDate(req)
    const ctx = getDayContext(date)
    const items = [
      ...ctx.diet.map((d) => ({
        time: d.created_at.slice(11, 16),
        type: 'diet' as const,
        title: `${MEAL_LABEL[d.meal_type]} · ${d.food_name}`,
        value: `${d.amount_g} g / ${d.kcal} kcal`,
      })),
      ...ctx.workouts.map((w) => ({
        time: w.start_time,
        type: 'workout' as const,
        title: `运动 · ${w.name}`,
        value: `${w.duration_min} 分钟 / ${w.kcal} kcal`,
      })),
      ...db
        .prepare('SELECT * FROM body_records WHERE date = ?')
        .all(date)
        .map((r: any) => ({
          time: '07:00',
          type: 'body' as const,
          title: '体重记录',
          value: `${r.weight_kg} kg`,
        })),
    ].sort((a, b) => a.time.localeCompare(b.time))
    res.json({ date, items })
  }),
)
