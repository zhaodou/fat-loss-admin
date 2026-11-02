<template>
  <div class="workout rise">
    <div class="daybar card">
      <div class="row gap-8">
        <el-button :icon="ArrowLeft" circle size="small" @click="go(-1)" />
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 148px" @change="load" />
        <el-button :icon="ArrowRight" circle size="small" @click="go(1)" />
        <span class="pill pill-plain">{{ relativeDay(date) }} · {{ weekday(date) }}</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="openAdd()">记录运动</el-button>
    </div>

    <div class="grid grid-4 mt-16">
      <StatCard title="今日运动" :value="items.length" unit="次" icon="🏃" :hint="`${todayMinutes} 分钟`" />
      <StatCard title="今日消耗" :value="n(todayKcal)" unit="kcal" icon="🔥" :hint="`约占日消耗 ${todayRatio}%`" tone="good" />
      <StatCard title="本周运动" :value="weekCount" unit="次" icon="📅" :hint="`计划 ${store.plan?.workout_days.length ?? 3} 次`" />
      <StatCard title="近 28 天" :value="n(summary?.total.minutes ?? 0)" unit="分钟" icon="⏱️" :hint="`${summary?.total.days ?? 0} 天有运动 · ${n(summary?.total.kcal ?? 0)} kcal`" />
    </div>

    <div class="grid workout-main mt-16">
      <SectionCard title="当天记录" :sub="`${items.length} 次 · ${todayMinutes} 分钟 · ${n(todayKcal)} kcal`">
        <div v-if="items.length" class="list">
          <div v-for="w in items" :key="w.id" class="wrow">
            <div class="wtime num">{{ w.start_time }}</div>
            <div class="wmain">
              <div class="row gap-8">
                <span class="wname">{{ w.name }}</span>
                <span class="pill pill-plain">{{ INTENSITY_LABEL[w.intensity] }}</span>
                <span class="pill pill-good">MET {{ w.met }}</span>
              </div>
              <div class="tiny muted mt-4">
                {{ w.duration_min }} 分钟
                <template v-if="w.distance_km"> · {{ w.distance_km }} km</template>
                <template v-if="w.avg_hr"> · 平均心率 {{ w.avg_hr }}</template>
                <template v-if="w.sets"> · {{ w.sets }} 组 × {{ w.reps }} 次</template>
                <template v-if="w.weight_kg"> · 负重 {{ w.weight_kg }} kg</template>
                <template v-if="w.note"> · {{ w.note }}</template>
              </div>
              <RouteMap v-if="w.route" :points="w.route" :duration-min="w.duration_min" class="mt-8" />
            </div>
            <div class="wright">
              <div class="wkcal num">{{ n(w.kcal) }}<i> kcal</i></div>
              <div class="row gap-4">
                <el-button :icon="Edit" link size="small" @click="openAdd(w)" />
                <el-button :icon="Delete" link size="small" type="danger" @click="remove(w.id)" />
              </div>
            </div>
          </div>
        </div>
        <EmptyState v-else icon="🏋️" title="今天还没有运动" :description="emptyHint" />
      </SectionCard>

      <SectionCard title="今天能动的时段" sub="根据你的上下班时间自动计算">
        <div class="slot-list">
          <div v-for="s in schedule?.slots ?? []" :key="s.key" class="slot-row" :class="{ off: !s.feasible }">
            <div class="slot-time num">{{ s.start }}<span>–{{ s.end }}</span></div>
            <div class="col gap-4">
              <span class="slot-act">{{ s.activity }}</span>
              <span class="tiny muted">{{ s.feasible ? `${s.durationMin} 分钟 · 约 ${s.kcal} kcal` : s.reason }}</span>
            </div>
            <el-button v-if="s.feasible" link type="primary" @click="quickAdd(s)">记录</el-button>
          </div>
        </div>
        <el-alert
          v-if="schedule?.mealWindow"
          class="mt-12"
          type="info"
          :closable="false"
          show-icon
          :title="`午休 ${schedule.mealWindow.start}–${schedule.mealWindow.end} 用于吃饭，运动安排在饭后`"
        />
      </SectionCard>
    </div>

    <div class="grid grid-2 mt-16">
      <SectionCard title="近 4 周运动量" sub="每周总时长 / 次数">
        <Chart :option="weekOption" height="230px" />
      </SectionCard>
      <SectionCard title="运动类型分布" sub="近 28 天">
        <Chart v-if="summary?.byCategory.length" :option="pieOption" height="230px" />
        <EmptyState v-else icon="📊" title="还没有足够数据" />
      </SectionCard>
    </div>

    <!-- 记录/编辑 -->
    <el-dialog v-model="dialog" :title="editingId ? '编辑运动' : '记录运动'" width="720" :close-on-click-modal="false" class="workout-dialog">
      <div v-if="currentCategory" class="type-hint">
        已按运动类型 <b>{{ currentCategory }}</b> 显示对应字段
      </div>
      <el-form label-width="78px" label-position="left">
        <el-form-item label="运动类型">
          <el-select
            v-model="form.exercise_id"
            filterable
            remote
            :remote-method="searchExercises"
            placeholder="搜索运动，如 快走 / 力量"
            style="width: 100%"
            @change="onPickExercise"
          >
            <el-option v-for="e in exercises" :key="e.id" :label="`${e.icon} ${e.name}`" :value="e.id">
              <div class="row-between">
                <span>{{ e.icon }} {{ e.name }}</span>
                <span class="tiny muted num">MET {{ e.met }} · {{ e.category }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <!-- 基础字段：所有类型都需要 -->
        <div class="grid grid-3" style="gap: 12px">
          <el-form-item v-if="visibleFields.includes('duration')" label="时长">
            <el-input-number v-model="form.duration_min" :min="1" :max="300" :step="5" style="width: 100%" />
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('intensity')" label="强度">
            <el-select v-model="form.intensity" style="width: 100%">
              <el-option label="低强度" value="low" />
              <el-option label="中强度" value="moderate" />
              <el-option label="高强度" value="high" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('start')" label="开始">
            <el-time-picker v-model="form.start_time" format="HH:mm" value-format="HH:mm" style="width: 100%" />
          </el-form-item>
        </div>

        <!-- 有氧 / 户外 / 球类：距离、心率 -->
        <div class="grid grid-3" style="gap: 12px">
          <el-form-item v-if="visibleFields.includes('distance')" label="距离 km">
            <el-input-number v-model="form.distance_km" :min="0" :max="200" :step="0.5" :precision="2" style="width: 100%" />
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('hr')" label="平均心率">
            <el-input-number v-model="form.avg_hr" :min="40" :max="220" :step="1" style="width: 100%" />
          </el-form-item>
          <!-- 力量：组数、次数、负重 -->
          <el-form-item v-if="visibleFields.includes('sets')" label="组数">
            <el-input-number v-model="form.sets" :min="0" :max="50" :step="1" style="width: 100%" />
          </el-form-item>
        </div>

        <div class="grid grid-3" style="gap: 12px">
          <el-form-item v-if="visibleFields.includes('reps')" label="次数/组">
            <el-input-number v-model="form.reps" :min="0" :max="200" :step="1" style="width: 100%" />
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('weight')" label="负重 kg">
            <el-input-number v-model="form.weight_kg" :min="0" :max="300" :step="0.5" :precision="1" style="width: 100%" />
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('met')" label="MET">
            <el-input-number v-model="form.met" :min="1" :max="20" :step="0.1" :precision="1" style="width: 100%" />
          </el-form-item>
        </div>

        <el-form-item v-if="visibleFields.includes('route')" label="运动轨迹">
          <div class="w-full">
            <RouteMap v-model:points="routePoints" :duration-min="form.duration_min" editable />
            <div class="tiny muted mt-4">在下方网格上点击即可生成轨迹（用于跑步/骑行复盘），也可以留空。</div>
          </div>
        </el-form-item>

        <el-form-item v-if="visibleFields.includes('note')" label="备注">
          <el-input v-model="form.note" placeholder="例如：配速 6 分 30 秒，状态不错" />
        </el-form-item>

        <div class="estimate">
          <div class="col">
            <span class="tiny muted">预计消耗</span>
            <div class="est-num num">{{ estimate }}<span> kcal</span></div>
          </div>
          <div class="tiny muted">
            MET × 3.5 × 体重 ÷ 200 × 分钟，强度系数 {{ intensityFactor }}。该消耗会从当天的日常活动中剔除，不与 BMR 重复计算。
          </div>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, Delete, Edit, Plus } from '@element-plus/icons-vue'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate, n, relativeDay, shift, weekday } from '@/utils/format'
import { axisStyle, gridStyle, palette, tooltipStyle } from '@/utils/chart'
import type { DaySchedule, Exercise, Slot, Workout, WorkoutSummary } from '@/types/api'
import StatCard from '@/components/StatCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import Chart from '@/components/Chart.vue'
import RouteMap from '@/components/RouteMap.vue'

const INTENSITY_LABEL: Record<string, string> = { low: '低强度', moderate: '中强度', high: '高强度' }

/**
 * 不同运动类型的表单字段：选了运动类型后，弹窗只显示该类型需要的字段。
 * 基础字段（duration/intensity/start/note）所有类型都有，这里只列「差异字段」。
 */
const CATEGORY_FIELDS: Record<string, string[]> = {
  有氧: ['duration', 'intensity', 'start', 'distance', 'hr', 'route', 'note'],
  力量: ['duration', 'intensity', 'start', 'sets', 'reps', 'weight', 'hr', 'note'],
  柔韧: ['duration', 'intensity', 'start', 'note'],
  球类: ['duration', 'intensity', 'start', 'distance', 'hr', 'note'],
  户外: ['duration', 'intensity', 'start', 'distance', 'hr', 'route', 'note'],
  日常: ['duration', 'intensity', 'start', 'note'],
}
// 未选类型（自定义运动）时显示全部字段，MET 也放开手动填
const DEFAULT_FIELDS = ['duration', 'intensity', 'start', 'distance', 'hr', 'met', 'route', 'note']

const store = useAppStore()
const date = ref(localDate())
const items = ref<Workout[]>([])
const weekItems = ref<Workout[]>([])
const summary = ref<WorkoutSummary>()
const schedule = ref<DaySchedule>()
const exercises = ref<Exercise[]>([])

const dialog = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const routePoints = ref<[number, number][]>([])
const estimate = ref(0)

const form = reactive({
  exercise_id: undefined as number | undefined,
  category: '' as string,
  name: '快走（6 km/h）',
  met: 4.3,
  duration_min: 30,
  intensity: 'low' as 'low' | 'moderate' | 'high',
  start_time: '19:30',
  distance_km: 0,
  avg_hr: 0,
  sets: 0,
  reps: 0,
  weight_kg: 0,
  note: '',
})

const visibleFields = computed(() => CATEGORY_FIELDS[form.category] ?? DEFAULT_FIELDS)
const currentCategory = computed(() => (form.category ? form.category : null))

const intensityFactor = computed(() => store.settings?.energy.intensityFactor[form.intensity] ?? 1)
const todayMinutes = computed(() => items.value.reduce((s, w) => s + w.duration_min, 0))
const todayKcal = computed(() => items.value.reduce((s, w) => s + w.kcal, 0))
const todayTdee = ref(0)
const todayRatio = computed(() => Math.round((todayKcal.value / Math.max(1, todayTdee.value)) * 100))
const weekCount = computed(() => {
  const days = new Set(weekItems.value.map((w) => w.date))
  return weekItems.value.length ? weekItems.value.filter((w) => shift(date.value, -6) <= w.date).length : 0
})

const emptyHint = computed(() => {
  const slot = schedule.value?.slots.find((s) => s.feasible)
  return slot ? `建议时段：${slot.start}–${slot.end} ${slot.activity}` : '今天没有合适的空档，休息也是计划的一部分'
})

const weekOption = computed(() => {
  const weeks = summary.value?.byWeek ?? []
  return {
    grid: gridStyle({ top: 30 }),
    tooltip: { ...tooltipStyle(), formatter: (p: any) => `${p[0].axisValue}<br/>${p.map((x: any) => `${x.seriesName} <b>${x.data}</b>`).join('<br/>')}` },
    legend: { right: 0, top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#6c7787', fontSize: 11 } },
    xAxis: { type: 'category', data: weeks.map((w) => w.week.slice(5).replace('-', '/')), ...axisStyle(), splitLine: { show: false } },
    yAxis: [
      { type: 'value', name: '分钟', nameTextStyle: { color: '#8f99a6', fontSize: 10 }, ...axisStyle() },
      { type: 'value', name: '次', nameTextStyle: { color: '#8f99a6', fontSize: 10 }, ...axisStyle(), splitLine: { show: false } },
    ],
    series: [
      { name: '时长', type: 'bar', data: weeks.map((w) => w.minutes), barWidth: 22, itemStyle: { color: '#12a37a', borderRadius: [5, 5, 0, 0] } },
      { name: '次数', type: 'line', yAxisIndex: 1, data: weeks.map((w) => w.count), smooth: true, itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2 } },
    ],
  }
})

const pieOption = computed(() => ({
  tooltip: { trigger: 'item', backgroundColor: 'rgba(19,26,34,0.92)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } },
  legend: { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: '#6c7787', fontSize: 11 } },
  color: palette,
  series: [
    {
      type: 'pie',
      radius: ['46%', '68%'],
      center: ['50%', '44%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data: (summary.value?.byCategory ?? []).map((c) => ({ name: c.category, value: c.kcal })),
    },
  ],
}))

async function load() {
  const [res, sum, sched, weekRes, energy] = await Promise.all([
    api.workouts(date.value),
    api.workoutSummary(28, date.value),
    api.schedule(date.value),
    api.workoutRange(shift(date.value, -6), date.value),
    api.energy(date.value),
  ])
  todayTdee.value = energy.breakdown.tdee
  items.value = res.items
  summary.value = sum
  schedule.value = sched
  weekItems.value = weekRes.items
}

function go(delta: number) {
  date.value = shift(date.value, delta)
  load()
}

async function searchExercises(q: string) {
  exercises.value = await api.exercises({ keyword: q })
}

function onPickExercise(id: number) {
  const ex = exercises.value.find((e) => e.id === id)
  if (ex) {
    form.name = ex.name
    form.met = ex.met
    form.intensity = ex.intensity
    form.category = ex.category
    // 非力量训练时清空力量专属字段，避免脏数据
    if (ex.category !== '力量') {
      form.sets = 0
      form.reps = 0
      form.weight_kg = 0
    }
  }
}

function openAdd(w?: Workout) {
  editingId.value = w?.id ?? null
  if (w) {
    const cat = w.exercise_id ? exercises.value.find((e) => e.id === w.exercise_id)?.category ?? '' : ''
    Object.assign(form, {
      exercise_id: w.exercise_id ?? undefined,
      category: cat,
      name: w.name,
      met: w.met,
      duration_min: w.duration_min,
      intensity: w.intensity,
      start_time: w.start_time,
      distance_km: w.distance_km ?? 0,
      avg_hr: w.avg_hr ?? 0,
      sets: w.sets ?? 0,
      reps: w.reps ?? 0,
      weight_kg: w.weight_kg ?? 0,
      note: w.note,
    })
    routePoints.value = w.route ? JSON.parse(w.route) : []
  } else {
    Object.assign(form, { exercise_id: undefined, category: '', name: '快走（6 km/h）', met: 4.3, duration_min: 30, intensity: 'low', start_time: '19:30', distance_km: 0, avg_hr: 0, sets: 0, reps: 0, weight_kg: 0, note: '' })
    routePoints.value = []
  }
  dialog.value = true
  refreshEstimate()
}

function quickAdd(slot: Slot) {
  openAdd()
  form.name = slot.activity
  form.met = slot.met
  form.intensity = slot.intensity
  form.duration_min = slot.durationMin
  form.start_time = slot.start
  refreshEstimate()
}

let timer: ReturnType<typeof setTimeout> | null = null
function refreshEstimate() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      const res = await api.estimateWorkout({
        date: date.value,
        met: form.met,
        duration_min: form.duration_min,
        intensity: form.intensity,
      })
      estimate.value = res.totalKcal
    } catch {
      estimate.value = 0
    }
  }, 200)
}

watch(() => [form.met, form.duration_min, form.intensity], refreshEstimate)

async function save() {
  saving.value = true
  try {
    const payload = {
      date: date.value,
      exercise_id: form.exercise_id,
      name: form.name,
      met: form.met,
      duration_min: form.duration_min,
      intensity: form.intensity,
      start_time: form.start_time,
      distance_km: form.distance_km || null,
      avg_hr: form.avg_hr || null,
      sets: form.sets || null,
      reps: form.reps || null,
      weight_kg: form.weight_kg || null,
      note: form.note,
      route: routePoints.value.length ? routePoints.value : null,
    }
    if (editingId.value) await api.updateWorkout(editingId.value, payload)
    else await api.addWorkout(payload)
    ElMessage.success('已保存')
    dialog.value = false
    await load()
    store.touch()
  } finally {
    saving.value = false
  }
}

async function remove(id: number) {
  try {
    await ElMessageBox.confirm('确定删除这条运动记录吗？', '删除', { type: 'warning' })
  } catch {
    return
  }
  await api.deleteWorkout(id)
  ElMessage.success('已删除')
  await load()
  store.touch()
}

onMounted(async () => {
  exercises.value = await api.exercises({})
  await load()
})
</script>

<style scoped>
.daybar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}
.workout-main {
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  align-items: start;
}
@media (max-width: 1100px) {
  .workout-main {
    grid-template-columns: minmax(0, 1fr);
  }
}
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wrow {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px dashed #f1f4f6;
}
.wrow:last-child {
  border-bottom: none;
}
.wtime {
  font-size: 12px;
  color: var(--ink-500);
  background: #f4f7f8;
  padding: 3px 8px;
  border-radius: 6px;
  height: fit-content;
}
.wmain {
  flex: 1;
  min-width: 0;
}
.wname {
  font-size: 13.5px;
  font-weight: 600;
}
.wright {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.wkcal {
  font-size: 15px;
  font-weight: 700;
  color: var(--brand-dark);
}
.wkcal i {
  font-style: normal;
  font-size: 10px;
  color: var(--ink-400);
  font-weight: 400;
}
.slot-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slot-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fbfdfc;
}
.slot-row.off {
  background: #fafafa;
  opacity: 0.7;
}
.slot-time {
  font-size: 13px;
  font-weight: 650;
  color: var(--brand-dark);
  white-space: nowrap;
}
.slot-time span {
  font-weight: 400;
  color: var(--ink-500);
  font-size: 12px;
}
.slot-act {
  font-size: 13px;
}
.estimate {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--brand-soft);
  border-radius: 12px;
  padding: 12px 16px;
}
.est-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--brand-dark);
}
.est-num span {
  font-size: 11px;
  color: var(--ink-500);
  margin-left: 3px;
  font-weight: 500;
}
.type-hint {
  font-size: 12px;
  color: var(--brand-dark);
  background: var(--brand-soft);
  border: 1px solid #d8efe6;
  border-radius: 8px;
  padding: 7px 12px;
  margin-bottom: 12px;
}
.type-hint b {
  font-weight: 700;
}
</style>

<style>
/* 弹窗整体限高：内容超出时仅 body 区滚动，底部提交按钮始终可见。
   完整覆盖 margin（去掉 EP 默认底部 50px），6vh + 84vh < 100vh，
   保证弹窗永远完整容纳在视口内，外层遮罩不会滚动、顶部不会被切。 */
.workout-dialog.el-dialog {
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  margin: 6vh auto;
}
.workout-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
