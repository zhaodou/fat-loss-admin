/**
 * 作息感知的运动排期引擎
 * ---------------------------------------------------------------------------
 * 硬约束（来自真实上班族作息）：
 * 1) 中午 12:00–14:00 的午休里必须先留出吃饭时间（默认 40 分钟），运动只能放在吃饭之后，
 *    且不安排中高强度（没有条件洗澡）。
 * 2) 晚间运动最早 18:00 开始，且不能和晚餐撞车（要么下班后先练再吃，要么饭后 1 小时）。
 * 3) 早上只安排低强度，且必须在通勤/早餐之前结束。
 * 任何一条不满足，就不生成该时段建议，并说明原因 —— 不建议「不存在的运动时间」。
 */
import { metKcal, round, toMin, fromMin } from './energy'
import { localDateStr } from './trend'
import type { PlanRow } from './data'

export interface Slot {
  key: 'morning' | 'lunch' | 'evening'
  label: string
  start: string
  end: string
  durationMin: number
  activity: string
  intensity: 'low' | 'moderate' | 'high'
  met: number
  kcal: number
  note: string
  feasible: boolean
  reason?: string
}

export interface DaySchedule {
  slots: Slot[]
  warnings: string[]
  mealWindow: { start: string; end: string; minutes: number }
  eveningEarliest: string
}

interface SlotTemplate {
  activity: string
  intensity: 'low' | 'moderate' | 'high'
  met: number
  note: string
}

const MORNING: SlotTemplate = {
  activity: '快走 / 拉伸',
  intensity: 'low',
  met: 3.5,
  note: '空腹低强度即可，喝 200ml 水再出门，不追求心率。',
}
const LUNCH: SlotTemplate = {
  activity: '饭后散步',
  intensity: 'low',
  met: 3.2,
  note: '吃完饭 10 分钟后再走，控血糖、顺带补步数，不占用午睡。',
}
const EVENING_CARDIO: SlotTemplate = {
  activity: '慢跑 / 椭圆机',
  intensity: 'moderate',
  met: 7,
  note: '心率控制在最大心率的 65%–75%，能说话但不能唱歌。',
}
const EVENING_STRENGTH: SlotTemplate = {
  activity: '力量训练（全身）',
  intensity: 'moderate',
  met: 5,
  note: '深蹲、硬拉、推举、划船各 3 组，减脂期保住肌肉比多做有氧更重要。',
}

export function buildDaySchedule(
  plan: PlanRow,
  weightKg: number,
  date: string,
  opts: { workoutDay?: boolean; preferStrength?: boolean } = {},
): DaySchedule {
  const warnings: string[] = []
  const slots: Slot[] = []

  const wake = toMin(plan.wake_time)
  const workStart = toMin(plan.work_start)
  const workEnd = toMin(plan.work_end)
  const lunchStart = toMin(plan.lunch_start)
  const lunchEnd = toMin(plan.lunch_end)
  const dinner = toMin(plan.dinner_time)
  const sleep = toMin(plan.sleep_time)
  const mealMinutes = plan.meal_minutes

  /* ------------------------------ 早间时段 ------------------------------ */
  // 起床后 15 分钟出门，必须在通勤 + 早餐之前收工（预留 50 分钟）
  const morningStart = wake + 15
  const morningEnd = workStart - 50
  const morningDuration = Math.min(40, morningEnd - morningStart)
  if (morningDuration >= 20) {
    slots.push(makeSlot('morning', '早间', morningStart, morningStart + morningDuration, MORNING, weightKg, true))
  } else {
    slots.push({
      ...makeSlot('morning', '早间', morningStart, Math.max(morningStart + 10, morningEnd), MORNING, weightKg, false),
      feasible: false,
      reason: `上班 ${plan.work_start}，起床到出门不足 30 分钟空档，早上不安排运动。`,
    })
  }

  /* ------------------------------ 午休时段 ------------------------------ */
  const mealWindow = { start: fromMin(lunchStart), end: fromMin(lunchStart + mealMinutes), minutes: mealMinutes }
  const lunchSlotStart = lunchStart + mealMinutes + 10 // 吃完饭歇 10 分钟
  const lunchSlotEnd = lunchEnd - 10 // 留 10 分钟回工位/午睡
  const lunchDuration = Math.min(35, lunchSlotEnd - lunchSlotStart)
  if (lunchDuration >= 15) {
    slots.push(
      makeSlot('lunch', '午休', lunchSlotStart, lunchSlotStart + lunchDuration, LUNCH, weightKg, true),
    )
  } else {
    slots.push({
      ...makeSlot('lunch', '午休', lunchSlotStart, Math.max(lunchSlotStart + 10, lunchSlotEnd), LUNCH, weightKg, false),
      feasible: false,
      reason: `午休 ${plan.lunch_start}–${plan.lunch_end} 扣除 ${mealMinutes} 分钟吃饭后不足 15 分钟，这个时段只保证吃饭。`,
    })
  }

  /* ------------------------------ 晚间时段 ------------------------------ */
  // 硬约束：最早 18:00
  const commuteBack = Math.max(18 * 60, toMin('18:00'), workEnd + 30)
  const eveningEarliest = fromMin(commuteBack)
  const isHardDay = opts.workoutDay !== false
  const template = opts.preferStrength ? EVENING_STRENGTH : EVENING_CARDIO

  if (!isHardDay) {
    // 休息日：饭后散步即可
    const start = Math.max(commuteBack, dinner + 30)
    const end = Math.min(start + 30, sleep - 60)
    if (end - start >= 15) {
      slots.push(makeSlot('evening', '晚间', start, end, LUNCH, weightKg, true))
    }
  } else {
    // 方案 A：下班后先练，再吃晚饭
    const aStart = commuteBack
    const aEnd = Math.min(aStart + 45, dinner - 10)
    // 方案 B：晚饭后 1 小时再练
    const bStart = Math.max(dinner + 60, commuteBack, 18 * 60)
    const bEnd = Math.min(bStart + 50, sleep - 60)

    if (aEnd - aStart >= 25) {
      slots.push(
        makeSlot('evening', '晚间', aStart, aEnd, template, weightKg, true, '练完 30 分钟内吃晚餐，蛋白质优先。'),
      )
    } else if (bEnd - bStart >= 25) {
      slots.push(
        makeSlot('evening', '晚间', bStart, bEnd, template, weightKg, true, '饭后 1 小时再开始，避免影响消化。'),
      )
    } else {
      const fallbackEnd = Math.min(commuteBack + 20, sleep - 30)
      slots.push({
        ...makeSlot('evening', '晚间', commuteBack, Math.max(commuteBack + 15, fallbackEnd), template, weightKg, false),
        feasible: false,
        reason: `晚餐 ${plan.dinner_time}、睡觉 ${plan.sleep_time}，18:00 后没有连续 25 分钟空档，今天建议改成 10 分钟居家力量或直接休息。`,
      })
    }
  }

  /* ------------------------------- 约束校验 ------------------------------ */
  if (lunchEnd - lunchStart < mealMinutes + 30) {
    warnings.push(
      `午休只有 ${lunchEnd - lunchStart} 分钟，扣除 ${mealMinutes} 分钟吃饭后剩不下运动时间，午间只安排散步级别活动。`,
    )
  }
  if (dinner < 18 * 60) {
    warnings.push(`晚餐时间 ${plan.dinner_time} 早于 18:00，晚间运动将顺延到饭后 1 小时。`)
  }
  if (sleep - toMin(plan.dinner_time) < 240) {
    warnings.push('晚餐到睡觉不足 4 小时，晚间训练强度不宜过高，避免影响入睡。')
  }
  if (toMin(plan.work_end) > 20 * 60) {
    warnings.push('下班时间晚于 20:00，晚间只保留 20 分钟拉伸/核心，别硬扛。')
  }

  // 严格保证：任何运动都不落在吃饭窗口内
  const safeSlots = slots.map((s) => {
    const ss = toMin(s.start)
    const se = toMin(s.end)
    const overlapsMeal = ss < lunchStart + mealMinutes && se > lunchStart
    if (overlapsMeal && s.feasible) {
      return { ...s, feasible: false, reason: '与午餐时间冲突，已取消该时段。' }
    }
    if (s.key === 'evening' && ss < 18 * 60 && s.feasible) {
      return { ...s, feasible: false, reason: '晚间运动不早于 18:00，已取消该时段。' }
    }
    return s
  })

  return { slots: safeSlots, warnings, mealWindow, eveningEarliest }
}

function makeSlot(
  key: Slot['key'],
  label: string,
  startMin: number,
  endMin: number,
  tpl: SlotTemplate,
  weightKg: number,
  feasible: boolean,
  noteOverride?: string,
): Slot {
  const duration = Math.max(5, Math.round(endMin - startMin))
  return {
    key,
    label,
    start: fromMin(startMin),
    end: fromMin(endMin),
    durationMin: duration,
    activity: tpl.activity,
    intensity: tpl.intensity,
    met: tpl.met,
    kcal: round(metKcal(tpl.met, weightKg, duration)),
    note: noteOverride ?? tpl.note,
    feasible,
  }
}

export interface WeekDayPlan {
  date: string
  weekday: number
  isWorkoutDay: boolean
  focus: string
  slots: Slot[]
  plannedKcal: number
}

/** 生成未来 7 天的训练安排：力量 2 次 + 有氧 1–2 次 + 主动恢复 */
export function buildWeekSchedule(plan: PlanRow, weightKg: number, startDate: string): WeekDayPlan[] {
  const out: WeekDayPlan[] = []
  const workoutDays = [...plan.workout_days].sort((a, b) => a - b)
  let hardCount = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${startDate}T00:00:00`)
    d.setDate(d.getDate() + i)
    const date = localDateStr(d)
    const weekday = d.getDay()
    const isWorkoutDay = workoutDays.includes(weekday)
    const preferStrength = isWorkoutDay && hardCount % 2 === 0
    if (isWorkoutDay) hardCount++
    const schedule = buildDaySchedule(plan, weightKg, date, { workoutDay: isWorkoutDay, preferStrength })
    const slots = schedule.slots.filter((s) => s.feasible)
    out.push({
      date,
      weekday,
      isWorkoutDay,
      focus: isWorkoutDay ? (preferStrength ? '力量训练' : '有氧') : '主动恢复',
      slots,
      plannedKcal: slots.reduce((s, x) => s + x.kcal, 0),
    })
  }
  return out
}
