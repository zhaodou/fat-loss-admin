/**
 * AI 减脂顾问（本地推理引擎）
 * ---------------------------------------------------------------------------
 * 设计原则（对应产品要求「AI 建议必须有数据依据」）：
 * 1) 所有结论都带 evidence：具体区间、样本量、数字，不允许「感觉你吃得有点多」。
 * 2) 单日体重永远不作为调整依据。调整阈值只看 14 天线性回归斜率 + 7 日平滑趋势。
 * 3) 硬闸门：饮食记录 < 5 天 或 体重记录 < 4 条时，禁止给出「减少摄入 / 增加运动」类建议，
 *    只输出「继续记录」。
 * 4) 调整幅度受限：单次摄入调整 ≤ 150 kcal/天，运动增量 ≤ 90 分钟/周，
 *    摄入不低于安全下限，缺口不超过 TDEE 的 25% 或 750 kcal。
 * 5) 运动建议必须来自作息引擎（午休先吃饭、晚间 ≥18:00），不生成不存在的空档。
 */
import { db, getSettings, nowIso } from '../db'
import { MEAL_LABEL, type MealType } from '../config'
import { clamp, healthyWeightRange, planDailyDeficit, recommendedTargetWeight, round } from './energy'
import { getDayContext, getPlan, type DayContext } from './data'
import { dailyStats, type DailyStat } from './stats'
import { buildDaySchedule, buildWeekSchedule, type DaySchedule, type WeekDayPlan } from './schedule'
import { diffDays, linearRegression, localDateStr, shiftDate } from './trend'

export interface Advice {
  id: string
  category: 'data' | 'diet' | 'exercise' | 'habit' | 'goal'
  level: 'good' | 'info' | 'warn' | 'danger'
  title: string
  summary: string
  evidence: string[]
  actions: string[]
  confidence: number
  adjustment?: string
}

export interface AdviceMetrics {
  date: string
  windowDays: number
  weightPoints: number
  loggedDietDays: number
  currentWeight: number
  trendWeight: number
  weeklyChange14: number
  weeklyChange28: number
  singleDayDelta: number
  avgIntake7: number
  avgIntake14: number
  avgTdee: number
  avgDeficit7: number
  avgDeficit14: number
  plannedDeficit: number
  targetIntake: number
  proteinAvg: number
  proteinTarget: number
  workouts7: number
  workoutMinutes7: number
  plannedWorkouts: number
  expectedWeeklyChange: number
  adherence: number | null
  macroRatio: { protein: number; carb: number; fat: number }
}

export interface AdvicePayload {
  date: string
  generatedAt: string
  engine: string
  score: number
  level: string
  headline: string
  summary: string
  metrics: AdviceMetrics
  advices: Advice[]
  nextActions: string[]
  guardrails: string[]
  schedule: DaySchedule
  weekPlan: WeekDayPlan[]
  goal: {
    targetWeight: number
    recommendedWeight: number
    healthyRange: { min: number; max: number; ideal: number }
    targetDate: string
    predictedDate: string
    daysLeft: number
    progress: number
    feasible: boolean
  } | null
}

const RULES = {
  minDietDays14: 5,
  minWeightPoints14: 4,
  maxIntakeCut: 150,
  maxExerciseAddPerWeek: 90,
  plateauWeightChange: 0.15,
  fastLossPerWeek: -1.2,
  slowLossPerWeek: -0.2,
  proteinTolerance: 0.8,
  dinnerLateHour: 20.5,
} as const

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function kg(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} kg`
}

function lastNDays(series: DailyStat[], n: number, end?: string): DailyStat[] {
  const filtered = end ? series.filter((s) => s.date <= end) : series
  return filtered.slice(-n)
}

function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0)
}

export function generateAdvice(date: string): AdvicePayload {
  const ctx = getDayContext(date)
  const settings = getSettings()
  const plan = getPlan()
  const energy = settings.energy
  const profile = ctx.profile

  const start = shiftDate(date, -27)
  const series = dailyStats(start, date)
  const s7 = lastNDays(series, 7, date)
  const s14 = lastNDays(series, 14, date)
  const s28 = series

  const weightPoints = s28.filter((s) => s.weight !== null) as (DailyStat & { weight: number })[]
  const p14 = weightPoints.filter((p) => p.date >= shiftDate(date, -13))
  const reg14 = linearRegression(p14.map((p) => ({ date: p.date, value: p.weight })))
  const reg28 = linearRegression(weightPoints.map((p) => ({ date: p.date, value: p.weight })))
  const weekly14 = round(reg14.slope * 7, 2)
  const weekly28 = round(reg28.slope * 7, 2)

  const emaValues: number[] = []
  let emaVal = weightPoints[0]?.weight ?? ctx.weight.weight_kg
  for (const p of weightPoints) {
    emaVal = 0.25 * p.weight + 0.75 * emaVal
    emaValues.push(emaVal)
  }
  const trendW = emaValues.length ? round(emaValues[emaValues.length - 1], 1) : ctx.weight.weight_kg
  const todayWeight = weightPoints.find((p) => p.date === date)?.weight ?? null
  const singleDayDelta = todayWeight !== null ? round(todayWeight - trendW, 1) : 0

  // 当天 21:00 前记录不完整，不纳入摄入均值，避免“晚餐还没吃”被算成节食
  const excludeToday = date === localDateStr() && new Date().getHours() < 21
  const intakeDays7 = excludeToday ? s7.filter((s) => s.date !== date) : s7
  const intakeDays14 = excludeToday ? s14.filter((s) => s.date !== date) : s14
  const logged7 = intakeDays7.filter((s) => s.hasDiet)
  const logged14 = intakeDays14.filter((s) => s.hasDiet)
  const avgIntake7 = logged7.length ? Math.round(sum(logged7.map((s) => s.intake)) / logged7.length) : 0
  const avgIntake14 = logged14.length ? Math.round(sum(logged14.map((s) => s.intake)) / logged14.length) : 0
  const avgTdee = Math.round(sum(s14.map((s) => s.tdee)) / Math.max(1, s14.length))
  const avgDeficit7 = logged7.length ? Math.round(sum(logged7.map((s) => s.deficit)) / logged7.length) : 0
  const avgDeficit14 = logged14.length ? Math.round(sum(logged14.map((s) => s.deficit)) / logged14.length) : 0
  const plannedDeficit = ctx.plannedDeficit
  const targetIntake = Math.max(ctx.energy.intakeFloor, avgTdee - plannedDeficit)

  const proteinAvg = logged14.length ? Math.round(proteinSum(s14) / logged14.length) : 0
  const proteinTarget = Math.round(ctx.weight.weight_kg * energy.proteinPerKg)
  const workouts7 = s7.filter((s) => s.exerciseMin > 0).length
  const workoutMinutes7 = sum(s7.map((s) => s.exerciseMin))
  const plannedWorkouts = plan.workout_days.length || 3
  const expectedWeeklyChange = round((-avgDeficit14 * 7) / 7700, 2)
  const actual14 = p14.length >= 2 ? round(p14[p14.length - 1].weight - p14[0].weight, 2) : null
  const adherence =
    actual14 !== null && Math.abs(expectedWeeklyChange) > 0.05
      ? round((actual14 / 2) / expectedWeeklyChange, 2)
      : null

  const macro = macroRatio(s14)

  const advices: Advice[] = []
  const dietDaysOk = logged14.length >= RULES.minDietDays14
  const weightOk = p14.length >= RULES.minWeightPoints14
  const canAdjust = dietDaysOk && weightOk

  /* ---------------------------- 1. 过度节食 ---------------------------- */
  if (avgIntake14 > 0 && (avgIntake14 < ctx.energy.intakeFloor * 0.95 || avgDeficit14 > Math.min(energy.maxDeficitKcal, avgTdee * energy.maxDeficitRatio) * 1.15)) {
    advices.push({
      id: 'over-restrict',
      category: 'diet',
      level: 'danger',
      title: '吃得太少了，这样掉的是肌肉和代谢',
      summary: `近 14 天平均摄入 ${avgIntake14} kcal，低于安全下限 ${ctx.energy.intakeFloor} kcal（或缺口已超出上限）。继续压会掉肌肉、掉基础代谢，恢复饮食后极易反弹。`,
      evidence: [
        `近 14 天 ${logged14.length} 天有饮食记录，日均摄入 ${avgIntake14} kcal`,
        `你的缺口上限被设定为 ${Math.round(Math.min(energy.maxDeficitKcal, avgTdee * energy.maxDeficitRatio))} kcal，实际日均 ${avgDeficit14} kcal`,
        `摄入下限：${profile.gender === 'male' ? '男性 1500' : '女性 1200'} kcal（当前设置 ${ctx.energy.intakeFloor} kcal）`,
      ],
      actions: [
        `把日均摄入拉回 ${ctx.energy.intakeFloor + 100}–${Math.max(targetIntake, ctx.energy.intakeFloor + 100)} kcal，优先加蛋白质和主食`,
        '每餐保证 1 掌心蛋白质（鸡胸 / 鱼 / 蛋 / 豆腐），不要只吃菜',
        '本周不要再增加运动量，先把吃够这件事做到',
      ],
      confidence: 0.92,
      adjustment: `建议上调 +${Math.max(100, ctx.energy.intakeFloor - avgIntake14)} kcal/天`,
    })
  }

  /* ---------------------------- 2. 数据不足 ---------------------------- */
  if (!canAdjust) {
    advices.push({
      id: 'data-gate',
      category: 'data',
      level: 'info',
      title: '数据还不够，先别急着改方案',
      summary: `近 14 天只有 ${logged14.length} 天饮食记录、${p14.length} 条体重记录。低于 ${RULES.minDietDays14} 天饮食 / ${RULES.minWeightPoints14} 条体重的门槛时，任何「减少热量」的建议都不靠谱，容易把正常波动当成失败。`,
      evidence: [
        `饮食记录覆盖率：${logged14.length}/14 天`,
        `体重记录：${p14.length} 条（近 14 天）`,
        `当前体重 ${ctx.weight.weight_kg} kg，7 日平滑趋势 ${trendW} kg`,
      ],
      actions: [
        '接下来 7 天每天记录三餐（用拍照识别能 30 秒记完）',
        '每天固定时间称重：早起排空后、只穿内衣',
        '记录够了再来生成一次建议，我会给出可执行的调整量',
      ],
      confidence: 0.95,
    })
  }

  /* ---------------------------- 3. 趋势判断 ---------------------------- */
  if (weightOk) {
    if (weekly14 <= RULES.fastLossPerWeek) {
      advices.push({
        id: 'lose-too-fast',
        category: 'goal',
        level: 'warn',
        title: '掉秤速度超出健康区间',
        summary: `近 14 天趋势 ${kg(weekly14)}/周，快于建议的 -0.5 ~ -1.0 kg/周。速度快不等于效果好，通常意味着水分和肌肉一起掉。`,
        evidence: [
          `14 天线性回归斜率：${weekly14} kg/周（${p14.length} 个数据点）`,
          `28 天趋势：${kg(weekly28)}/周`,
          `近 14 天日均缺口 ${avgDeficit14} kcal，日消耗 ${avgTdee} kcal`,
        ],
        actions: [
          `每天加回 100–150 kcal，优先加在训练日的主食`,
          '每周至少 2 次力量训练，把肌肉留住',
          '蛋白质吃够 ' + proteinTarget + ' g/天',
        ],
        confidence: 0.86,
        adjustment: '上调 +100~150 kcal/天',
      })
    } else if (weekly14 < RULES.slowLossPerWeek && weekly14 > -1.2 && avgDeficit14 > 100) {
      advices.push({
        id: 'trend-good',
        category: 'goal',
        level: 'good',
        title: '节奏是对的，保持住',
        summary: `近 14 天体重趋势 ${kg(weekly14)}/周，落在健康减脂区间（-0.2 ~ -1.0 kg/周），而且日均缺口 ${avgDeficit14} kcal 与计划基本一致。`,
        evidence: [
          `14 天趋势 ${weekly14} kg/周，28 天趋势 ${kg(weekly28)}/周`,
          `近 14 天 ${logged14.length} 天饮食记录，日均摄入 ${avgIntake14} kcal`,
          `日均总消耗 ${avgTdee} kcal（含运动 ${Math.round(avgExercise(s14))} kcal）`,
        ],
        actions: ['维持当前摄入与训练安排，不要额外加码', '每周固定同一时间称重 3 次以上，看趋势不看单日'],
        confidence: 0.9,
      })
    }

    if (Math.abs(weekly14) < RULES.plateauWeightChange && logged14.length >= 10 && avgDeficit14 >= 200) {
      advices.push({
        id: 'plateau',
        category: 'goal',
        level: 'warn',
        title: '可能进入平台期，但先排除记录误差',
        summary: `近 14 天趋势几乎没动（${kg(weekly14)}），同时日均缺口有 ${avgDeficit14} kcal。先别急着砍热量——先确认摄入记录是否准确，再做小幅调整。`,
        evidence: [
          `14 天趋势 ${weekly14} kg/周（阈值 ±${RULES.plateauWeightChange}）`,
          `日均缺口 ${avgDeficit14} kcal，理论应下降 ${Math.abs(round((avgDeficit14 * 14) / 7700, 1))} kg`,
          `实际 14 天体重变化 ${kg(actual14 ?? 0)}，偏差比 ${adherence !== null ? pct(adherence) : '—'}`,
        ],
        actions: [
          '先当 3 天「称重派」：所有入口食物上秤，含油、酱料、饮料',
          '检查运动消耗是否高估：手环数据通常偏高 10%–20%',
          `每天多走 2000 步（约 ${Math.round(ctx.weight.weight_kg * 0.9)} kcal），比再砍饭更容易坚持`,
          '连续 2 周仍不动，再把主食减 30 g（约 -100 kcal）',
        ],
        confidence: 0.72,
        adjustment: '先核查记录，再考虑 -100 kcal',
      })
    }

    if (weekly14 > 0.2) {
      advices.push({
        id: 'weight-up',
        category: 'diet',
        level: 'warn',
        title: '体重在往上走，先看摄入端',
        summary: `近 14 天趋势 ${kg(weekly14)}/周，日均缺口 ${avgDeficit14} kcal 没有达到计划值。这种情况下优先收紧饮食，而不是加练。`,
        evidence: [
          `14 天趋势 ${weekly14} kg/周`,
          `日均摄入 ${avgIntake14} kcal，目标摄入 ${targetIntake} kcal，差 ${Math.max(0, avgIntake14 - targetIntake)} kcal`,
          `近 14 天 ${logged14.length}/14 天有记录`,
        ],
        actions: [
          `把每天摄入控制在 ${targetIntake} kcal 以内（先减 ${Math.min(RULES.maxIntakeCut, Math.max(100, avgIntake14 - targetIntake))} kcal）`,
          '优先砍液体热量：奶茶、果汁、含糖咖啡',
          '晚餐主食减到 1 拳（约 100 g 熟重）',
        ],
        confidence: canAdjust ? 0.8 : 0.5,
        adjustment: `-${Math.min(RULES.maxIntakeCut, Math.max(100, avgIntake14 - targetIntake))} kcal/天`,
      })
    }

    /* ------------------------ 4. 缺口执行偏差 ------------------------ */
    if (canAdjust && plannedDeficit > 100 && avgDeficit14 < plannedDeficit * 0.7 && weekly14 > -RULES.slowLossPerWeek) {
      const cut = clamp(Math.round((plannedDeficit - avgDeficit14) / 2 / 10) * 10, 50, RULES.maxIntakeCut)
      advices.push({
        id: 'deficit-gap',
        category: 'diet',
        level: 'warn',
        title: `缺口只完成了 ${pct(avgDeficit14 / plannedDeficit)}`,
        summary: `计划每天 ${plannedDeficit} kcal 缺口，实际 ${avgDeficit14} kcal，14 天累计少减约 ${Math.round(((plannedDeficit - avgDeficit14) * 14) / 7700 * 10) / 10} kg。`,
        evidence: [
          `计划缺口 ${plannedDeficit} kcal / 实际 ${avgDeficit14} kcal（近 14 天均值）`,
          `日均摄入 ${avgIntake14} kcal，目标 ${targetIntake} kcal`,
          `14 天趋势 ${kg(weekly14)}/周`,
        ],
        actions: [
          `把每天摄入下调 ${cut} kcal（分两步走，先执行 1 周）`,
          `等量替换：白米饭 150 g → 100 g（约 -58 kcal）；含糖饮料 → 无糖茶（约 -120 kcal）`,
          '每周加 1 次 30 分钟快走（约 -110 kcal），比继续饿更可持续',
        ],
        confidence: 0.84,
        adjustment: `-${cut} kcal/天`,
      })
    }

    /* --------------------- 5. 单日波动（明确不调整） --------------------- */
    if (Math.abs(singleDayDelta) >= 0.5) {
      advices.push({
        id: 'single-day-noise',
        category: 'data',
        level: 'info',
        title: '今天这个数字不用当真',
        summary: `今天体重比 7 日趋势${singleDayDelta > 0 ? '高' : '低'} ${Math.abs(singleDayDelta)} kg，属于正常水分波动（盐分、碳水、排便、生理期都会影响）。我不会因为这一天改你的方案。`,
        evidence: [
          `今日 ${todayWeight} kg vs 趋势 ${trendW} kg，偏差 ${singleDayDelta} kg`,
          `近 7 天体重极差 ${round(Math.max(...s7.filter((s) => s.weight).map((s) => s.weight as number), trendW) - Math.min(...s7.filter((s) => s.weight).map((s) => s.weight as number), trendW), 1)} kg`,
          `14 天趋势仍为 ${kg(weekly14)}/周`,
        ],
        actions: ['按原计划吃和练，3 天后再看趋势', '前一晚吃了重口味或碳水多，第二天 +1 kg 很常见'],
        confidence: 0.9,
      })
    }

    /* --------------------------- 6. 目标可行性 --------------------------- */
    if (ctx.goal && weightOk) {
      const projection = planDailyDeficit(
        ctx.weight.weight_kg,
        ctx.goal.target_weight,
        ctx.goal.target_date,
        date,
        avgTdee,
        energy,
      )
      const gapDays = diffDays(projection.predictedDate, ctx.goal.target_date)
      if (gapDays > 14) {
        advices.push({
          id: 'goal-unrealistic',
          category: 'goal',
          level: 'info',
          title: '目标日期偏紧，但我不建议再加大缺口',
          summary: `按当前节奏，预计 ${projection.predictedDate} 达到 ${ctx.goal.target_weight} kg，比目标日期 ${ctx.goal.target_date} 晚 ${gapDays} 天。硬压缺口只会掉肌肉。`,
          evidence: [
            `当前 ${ctx.weight.weight_kg} kg → 目标 ${ctx.goal.target_weight} kg，剩余 ${round(ctx.weight.weight_kg - ctx.goal.target_weight, 1)} kg`,
            `按健康速度 -0.5 kg/周需要约 ${Math.ceil(((ctx.weight.weight_kg - ctx.goal.target_weight) * 7700) / (0.5 * 7700))} 周`,
            `14 天实际趋势 ${kg(weekly14)}/周`,
          ],
          actions: [
            `把目标日期顺延到 ${projection.predictedDate} 之后，成功率更高`,
            '或者把目标体重上调 1–2 kg（腰围和体脂比体重更重要）',
            '保持当前缺口，不要超过每日上限',
          ],
          confidence: 0.83,
        })
      }
    }
  }

  /* ---------------------------- 7. 蛋白质 ---------------------------- */
  if (proteinAvg > 0 && proteinAvg < proteinTarget * RULES.proteinTolerance) {
    advices.push({
      id: 'protein-low',
      category: 'diet',
      level: 'warn',
      title: '蛋白质不够，减脂期最容易掉肌肉',
      summary: `近 14 天日均蛋白质约 ${proteinAvg} g，目标是 ${proteinTarget} g（${energy.proteinPerKg} g/kg 体重）。缺口 ${Math.max(0, proteinTarget - proteinAvg)} g，相当于 2 个鸡蛋 + 1 盒希腊酸奶。`,
      evidence: [
        `日均蛋白质 ${proteinAvg} g / 目标 ${proteinTarget} g`,
        `体重 ${ctx.weight.weight_kg} kg × ${energy.proteinPerKg} g/kg`,
        `蛋白质供能占比 ${macro.protein}%`,
      ],
      actions: [
        `早餐加 2 个鸡蛋（+12 g）或 200 g 希腊酸奶（+18 g）`,
        `午餐/晚餐各保证 1 掌心肉禽鱼（约 25–30 g 蛋白质）`,
        '训练后 1 小时内补 20–30 g 蛋白质',
      ],
      confidence: 0.88,
      adjustment: `+${Math.min(40, proteinTarget - proteinAvg)} g 蛋白质/天`,
    })
  }

  /* ---------------------------- 8. 饮食结构 ---------------------------- */
  if (logged14.length >= 5) {
    if (macro.fat > 38) {
      advices.push({
        id: 'fat-high',
        category: 'diet',
        level: 'info',
        title: '脂肪占比偏高',
        summary: `近 14 天脂肪供能占比 ${macro.fat}%（建议 20%–30%）。中餐的隐藏油（炒菜、红油、坚果）是主要来源。`,
        evidence: [`蛋白质 ${macro.protein}% / 碳水 ${macro.carb}% / 脂肪 ${macro.fat}%`, `统计区间内共 ${logged14.length} 天记录`],
        actions: ['把 1 个炒菜换成蒸/煮/白灼', '坚果每天不超过 1 小把（约 15 g）', '外卖备注少油、酱汁分装'],
        confidence: 0.75,
      })
    } else if (macro.carb > 62) {
      advices.push({
        id: 'carb-high',
        category: 'diet',
        level: 'info',
        title: '碳水占比偏高、蛋白质偏低',
        summary: `碳水供能 ${macro.carb}%，蛋白质只有 ${macro.protein}%。这种结构饿得快，也更容易掉肌肉。`,
        evidence: [`蛋白质 ${macro.protein}% / 碳水 ${macro.carb}% / 脂肪 ${macro.fat}%`],
        actions: ['每餐先吃蛋白质和蔬菜，最后吃主食', '白米面替换 1/3 为杂粮或薯类', '加餐用无糖酸奶 + 水果替代饼干面包'],
        confidence: 0.7,
      })
    }
  }

  /* ---------------------------- 9. 进餐时间 ---------------------------- */
  const dinnerHour = dinnerHourOf(date)
  if (dinnerHour !== null && dinnerHour >= RULES.dinnerLateHour) {
    advices.push({
      id: 'dinner-late',
      category: 'habit',
      level: 'info',
      title: '晚餐偏晚，影响睡眠和第二天的体重',
      summary: `最近一次晚餐记录时间 ${formatHour(dinnerHour)}，晚于 ${formatHour(RULES.dinnerLateHour)}。吃太晚容易水肿、影响深睡，第二天体重偏高。`,
      evidence: [`晚餐记录时间 ${formatHour(dinnerHour)}`, `计划晚餐时间 ${plan.dinner_time}`, `计划睡觉时间 ${plan.sleep_time}`],
      actions: [`尽量在 ${plan.dinner_time} 前吃完`, '加班时把晚餐拆成两顿：18:30 主餐 + 21:00 前少量蛋白质', '晚餐减少精制碳水，避免第二天水肿'],
      confidence: 0.7,
    })
  }

  /* ---------------------------- 10. 运动 ---------------------------- */
  const schedule = buildDaySchedule(plan, ctx.weight.weight_kg, date, {
    workoutDay: plan.workout_days.includes(new Date(`${date}T00:00:00`).getDay()),
    preferStrength: true,
  })
  const feasibleSlots = schedule.slots.filter((s) => s.feasible)
  const eveningSlot = feasibleSlots.find((s) => s.key === 'evening')
  const lunchSlot = feasibleSlots.find((s) => s.key === 'lunch')

  if (workouts7 < plannedWorkouts) {
    advices.push({
      id: 'workout-gap',
      category: 'exercise',
      level: 'warn',
      title: `本周运动 ${workouts7}/${plannedWorkouts} 次，缺 ${plannedWorkouts - workouts7} 次`,
      summary: `计划每周 ${plannedWorkouts} 次，近 7 天完成 ${workouts7} 次、共 ${workoutMinutes7} 分钟。下面这些时段是根据你的上下班时间算出来的，不需要额外挤时间。`,
      evidence: [
        `近 7 天运动 ${workouts7} 次 / ${workoutMinutes7} 分钟`,
        `午休 ${plan.lunch_start}–${plan.lunch_end}，其中 ${plan.meal_minutes} 分钟用于吃饭`,
        `晚间可用时段最早 ${schedule.eveningEarliest}`,
      ],
      actions: [
        lunchSlot
          ? `午休：${lunchSlot.start}–${lunchSlot.end} ${lunchSlot.activity}（${lunchSlot.durationMin} 分钟，约 ${lunchSlot.kcal} kcal）`
          : '午休时间不够，这个时段只保证吃饭',
        eveningSlot
          ? `晚间：${eveningSlot.start}–${eveningSlot.end} ${eveningSlot.activity}（${eveningSlot.durationMin} 分钟，约 ${eveningSlot.kcal} kcal）`
          : '晚间没有连续空档，改成 10 分钟居家核心',
        `本周补 ${Math.min(2, plannedWorkouts - workouts7)} 次即可，不要一次补完`,
      ],
      confidence: 0.85,
    })
  } else if (weekly14 > -RULES.slowLossPerWeek && workoutMinutes7 >= 120) {
    advices.push({
      id: 'training-quality',
      category: 'exercise',
      level: 'info',
      title: '运动量够了，但可能需要换刺激',
      summary: `近 7 天练了 ${workouts7} 次、${workoutMinutes7} 分钟，体重趋势 ${kg(weekly14)}/周。同样的有氧做久了，身体会适应。`,
      evidence: [`周运动 ${workouts7} 次 / ${workoutMinutes7} 分钟`, `14 天趋势 ${kg(weekly14)}/周`, `日均运动消耗 ${Math.round(avgExercise(s14))} kcal`],
      actions: ['把 1 次匀速有氧换成 20 分钟间歇（快 1 分钟 / 慢 1 分钟）', '每周加 2 次力量训练，每次 30 分钟', '走路速度提到稍喘但能说话的强度'],
      confidence: 0.7,
    })
  }

  /* ------------------------- 11. 记录一致性校验 ------------------------- */
  if (canAdjust && adherence !== null && (adherence < 0.5 || adherence > 1.6) && Math.abs(expectedWeeklyChange) > 0.2) {
    advices.push({
      id: 'record-bias',
      category: 'data',
      level: 'info',
      title: '理论值和实际值对不上，多半是记录偏差',
      summary: `按记录的缺口推算每周应减 ${Math.abs(expectedWeeklyChange).toFixed(2)} kg，实际 ${Math.abs(weekly14).toFixed(2)} kg（比值 ${pct(adherence)}）。常见原因：油和酱料没算、运动消耗高估、体重不是同一时间称的。`,
      evidence: [
        `理论周变化 ${expectedWeeklyChange} kg（日均缺口 ${avgDeficit14} kcal）`,
        `实际周变化 ${weekly14} kg（14 天回归）`,
        `比值 ${pct(adherence)}`,
      ],
      actions: ['连续 3 天用厨房秤称重所有食材，包括油', '外食按「同类菜品 +20% 热量」估', '称重固定在早起排空后'],
      confidence: 0.65,
    })
  }

  /* --------------------------- 12. 正向反馈 --------------------------- */
  if (logged7.length >= 5 && !advices.some((a) => a.level === 'danger')) {
    advices.push({
      id: 'consistency',
      category: 'habit',
      level: 'good',
      title: `本周记录了 ${logged7.length} 天，这就是最难的部分`,
      summary: '记录本身就是有效干预：愿意记录的人，减脂成功率显著更高。继续保持这个节奏。',
      evidence: [`近 7 天 ${logged7.length}/7 天有饮食记录`, `近 14 天 ${logged14.length}/14 天`, `累计 ${series.reduce((s, d) => s + d.mealCount, 0)} 条饮食记录`],
      actions: ['保持记录习惯，不用追求 100% 精确', '每周日花 3 分钟看一眼周报'],
      confidence: 0.95,
    })
  }

  /* ------------------------------ 评分 ------------------------------ */
  const score = calcScore({
    logged14: logged14.length,
    avgDeficit14,
    plannedDeficit,
    proteinAvg,
    proteinTarget,
    workouts7,
    plannedWorkouts,
    weekly14,
    danger: advices.some((a) => a.level === 'danger'),
  })

  const level = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'needs_attention'
  const primary = advices.find((a) => a.level === 'danger') ?? advices.find((a) => a.level === 'warn') ?? advices.find((a) => a.level === 'good')

  const headline = buildHeadline({ score, level, weekly14, avgDeficit14, plannedDeficit, logged14: logged14.length })
  const nextActions = advices
    .filter((a) => a.actions.length)
    .slice(0, 3)
    .flatMap((a) => a.actions.slice(0, 1))

  const guardrails = [
    `本次分析基于 ${date} 往前 28 天：${weightPoints.length} 条体重记录、${logged14.length}/14 天饮食记录、${workouts7} 次运动。`,
    '单日体重波动不作为调整依据，所有趋势结论使用 14 天线性回归 + 7 日指数平滑。',
    `摄入下限 ${ctx.energy.intakeFloor} kcal/天，缺口上限 ${Math.round(Math.min(energy.maxDeficitKcal, avgTdee * energy.maxDeficitRatio))} kcal/天（TDEE 的 ${pct(energy.maxDeficitRatio)}）。`,
    '运动只安排在你的真实空档：午休扣除吃饭时间后剩余，晚间不早于 18:00。',
    `单次摄入调整不超过 ${RULES.maxIntakeCut} kcal/天，运动增量不超过 ${RULES.maxExerciseAddPerWeek} 分钟/周。`,
  ]

  return {
    date,
    generatedAt: nowIso(),
    engine: 'local-rules-v1',
    score,
    level,
    headline,
    summary:
      primary?.summary ??
      '数据还在积累，先把每天的饮食和体重记下来，我才能给出真正针对你的建议。',
    metrics: {
      date,
      windowDays: 28,
      weightPoints: weightPoints.length,
      loggedDietDays: logged14.length,
      currentWeight: ctx.weight.weight_kg,
      trendWeight: trendW,
      weeklyChange14: weekly14,
      weeklyChange28: weekly28,
      singleDayDelta,
      avgIntake7,
      avgIntake14,
      avgTdee,
      avgDeficit7,
      avgDeficit14,
      plannedDeficit,
      targetIntake,
      proteinAvg,
      proteinTarget,
      workouts7,
      workoutMinutes7,
      plannedWorkouts,
      expectedWeeklyChange,
      adherence,
      macroRatio: macro,
    },
    advices,
    nextActions,
    guardrails,
    schedule,
    weekPlan: buildWeekSchedule(plan, ctx.weight.weight_kg, date),
    goal: ctx.goal
      ? {
          targetWeight: ctx.goal.target_weight,
          recommendedWeight: recommendedTargetWeight(profile.height_cm, ctx.weight.weight_kg, profile.body_fat_pct),
          healthyRange: healthyWeightRange(profile.height_cm),
          targetDate: ctx.goal.target_date,
          predictedDate: planDailyDeficit(ctx.weight.weight_kg, ctx.goal.target_weight, ctx.goal.target_date, date, avgTdee, energy).predictedDate,
          daysLeft: Math.max(0, diffDays(date, ctx.goal.target_date)),
          progress: Math.round(
            clamp(
              ((ctx.goal.start_weight - ctx.weight.weight_kg) / Math.max(0.1, ctx.goal.start_weight - ctx.goal.target_weight)) * 100,
              -20,
              120,
            ),
          ),
          feasible: planDailyDeficit(ctx.weight.weight_kg, ctx.goal.target_weight, ctx.goal.target_date, date, avgTdee, energy).feasible,
        }
      : null,
  }
}

/* ------------------------------- helpers ------------------------------- */

function proteinSum(series: DailyStat[]): number {
  if (!series.length) return 0
  const rows = db
    .prepare('SELECT COALESCE(SUM(protein),0) AS p FROM diet_entries WHERE date BETWEEN ? AND ?')
    .get(series[0].date, series[series.length - 1].date) as { p: number }
  return rows.p
}

function macroRatio(series: DailyStat[]): { protein: number; carb: number; fat: number } {
  if (!series.length) return { protein: 0, carb: 0, fat: 0 }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(protein),0) AS p, COALESCE(SUM(carb),0) AS c, COALESCE(SUM(fat),0) AS f
       FROM diet_entries WHERE date BETWEEN ? AND ?`,
    )
    .get(series[0].date, series[series.length - 1].date) as { p: number; c: number; f: number }
  const pK = row.p * 4
  const cK = row.c * 4
  const fK = row.f * 9
  const total = pK + cK + fK || 1
  return { protein: Math.round((pK / total) * 100), carb: Math.round((cK / total) * 100), fat: Math.round((fK / total) * 100) }
}

function avgExercise(series: DailyStat[]): number {
  if (!series.length) return 0
  return sum(series.map((s) => s.exerciseKcal)) / series.length
}

function dinnerHourOf(date: string): number | null {
  const rows = db
    .prepare("SELECT created_at FROM diet_entries WHERE date = ? AND meal_type = 'dinner' ORDER BY created_at DESC LIMIT 1")
    .all(date) as { created_at: string }[]
  if (!rows.length) return null
  const d = new Date(rows[0].created_at)
  return d.getHours() + d.getMinutes() / 60
}

function formatHour(h: number): string {
  const hour = Math.floor(h)
  const min = Math.round((h - hour) * 60)
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function calcScore(input: {
  logged14: number
  avgDeficit14: number
  plannedDeficit: number
  proteinAvg: number
  proteinTarget: number
  workouts7: number
  plannedWorkouts: number
  weekly14: number
  danger: boolean
}): number {
  const logging = Math.min(25, (input.logged14 / 14) * 25)
  const adherence =
    input.plannedDeficit > 0
      ? Math.max(0, 25 - (Math.abs(input.avgDeficit14 - input.plannedDeficit) / input.plannedDeficit) * 25)
      : 12
  const protein = Math.min(20, (input.proteinAvg / Math.max(1, input.proteinTarget)) * 20)
  const workout = Math.min(15, (input.workouts7 / Math.max(1, input.plannedWorkouts)) * 15)
  const trend =
    input.weekly14 <= -0.2 && input.weekly14 >= -1.2 ? 15 : input.weekly14 < -1.2 ? 9 : input.weekly14 < 0.2 ? 11 : 4
  const raw = logging + adherence + protein + workout + trend
  return Math.round(clamp(input.danger ? Math.min(raw, 55) : raw, 0, 100))
}

function buildHeadline(input: {
  score: number
  level: string
  weekly14: number
  avgDeficit14: number
  plannedDeficit: number
  logged14: number
}): string {
  if (input.logged14 < 5) return '先记录 7 天，我们再谈调整'
  if (input.level === 'excellent') return `执行得很稳：趋势 ${kg(input.weekly14)}/周，按当前节奏继续`
  if (input.level === 'good') return `整体在轨道上，趋势 ${kg(input.weekly14)}/周`
  if (input.level === 'fair') return `有些偏差：缺口完成 ${pct(input.plannedDeficit ? Math.max(0, input.avgDeficit14 / input.plannedDeficit) : 0)}，先抓一个变量`
  return '先止损：吃够、睡够，再谈减脂'
}
