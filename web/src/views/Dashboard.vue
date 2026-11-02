<template>
  <div v-if="data" class="dash rise">
    <!-- 顶部欢迎 -->
    <section class="hero card">
      <div class="hero-left">
        <div class="hero-greet">{{ greeting }}，{{ data.profile.nickname }}</div>
        <div class="hero-sub">
          {{ prettyDate(data.date) }} {{ weekday(data.date) }} · 身高 {{ data.profile.height }} cm · BMI
          {{ data.profile.bmi }}（{{ data.profile.bmiCategory.label }}）
          <span v-if="data.streak > 1" class="pill pill-good" style="margin-left: 8px">连续记录 {{ data.streak }} 天</span>
        </div>
        <div class="hero-advice">
          <el-icon><MagicStick /></el-icon>
          <span>{{ data.advice?.headline || advice?.headline || '还没有生成建议，先记录两天数据试试' }}</span>
          <router-link to="/advisor" class="hero-link">查看完整分析 →</router-link>
        </div>
      </div>
      <div class="hero-right">
        <div class="score">
          <el-progress
            type="dashboard"
            :percentage="data.advice?.score ?? advice?.score ?? 0"
            :width="104"
            :stroke-width="8"
            color="#12a37a"
          >
            <template #default="{ percentage }">
              <div class="score-num num">{{ Math.round(percentage) }}</div>
              <div class="score-label">执行分</div>
            </template>
          </el-progress>
        </div>
        <div class="hero-meta">
          <div class="hero-meta-row">
            <span class="muted tiny">本周记录</span>
            <b class="num">{{ data.week.loggedDays }}/7 天</b>
          </div>
          <div class="hero-meta-row">
            <span class="muted tiny">本周运动</span>
            <b class="num">{{ data.week.workoutDays }} 次 / {{ data.week.exerciseMin }} 分钟</b>
          </div>
        </div>
      </div>
    </section>

    <!-- 四个核心指标 -->
    <div class="grid grid-4 mt-16">
      <StatCard
        title="今日体重"
        :value="weightText"
        :unit="weightUnit"
        :icon="'⚖️'"
        :hint="weightHint"
        tone="neutral"
      >
        <template #foot>
          <span v-if="data.weight.deltaFromTrend !== null" class="pill" :class="data.weight.deltaFromTrend <= 0 ? 'pill-good' : 'pill-warn'">
            较趋势 {{ signed(data.weight.deltaFromTrend, 1) }} kg
          </span>
        </template>
      </StatCard>

      <StatCard
        title="热量摄入"
        :value="n(data.intake.kcal)"
        unit="kcal"
        icon="🍽️"
        :hint="`目标 ${n(data.intake.target)} · 还可吃 ${n(Math.max(0, data.intake.remaining))}`"
        :progress="data.intake.completion"
        :tone="data.intake.kcal > data.intake.target ? 'warn' : 'good'"
      />

      <StatCard
        title="总消耗 TDEE"
        :value="n(data.burn.tdee)"
        unit="kcal"
        icon="🔥"
        :hint="`基础 ${n(data.burn.bmr)} + 日常 ${n(data.burn.neat)} + 运动 ${n(data.burn.exercise)}`"
      >
        <template #foot>
          <span class="pill pill-plain">活动系数 {{ data.burn.activityFactor }}</span>
        </template>
      </StatCard>

      <StatCard
        title="热量缺口"
        :value="n(data.deficit.value)"
        unit="kcal"
        icon="📉"
        :hint="`目标 ${n(data.deficit.planned)} · 完成 ${data.deficit.completion}%`"
        :progress="clamp(data.deficit.completion, 0, 100)"
        :tone="deficitTone"
      >
        <template #foot>
          <span class="pill" :class="deficitPill">{{ deficitLabel }}</span>
        </template>
      </StatCard>
    </div>

    <el-alert
      v-if="data.deficit.notes.length"
      class="mt-12"
      :type="data.deficit.status === 'over_restrict' ? 'error' : 'info'"
      :closable="false"
      show-icon
      :title="data.deficit.notes.join(' ')"
    />

    <!-- 主体两栏 -->
    <div class="dash-main mt-16">
      <div class="col gap-16">
        <SectionCard title="体重趋势" sub="7 日平滑趋势 + 每日实测，目标线在下方虚线">
          <template #extra>
            <span class="pill" :class="data.weight.weeklyChange < 0 ? 'pill-good' : 'pill-warn'">
              趋势 {{ signed(data.weight.weeklyChange, 2) }} kg/周
            </span>
            <router-link to="/body"><el-button link type="primary">详细 →</el-button></router-link>
          </template>
          <Chart :option="weightOption" height="240px" />
          <div class="mini-stats">
            <div><span class="muted tiny">近 7 天波动</span><b class="num">{{ data.weight.range.spread }} kg</b></div>
            <div><span class="muted tiny">趋势体重</span><b class="num">{{ data.weight.trend }} kg</b></div>
            <div><span class="muted tiny">目标体重</span><b class="num">{{ data.goal?.targetWeight ?? '—' }} kg</b></div>
            <div><span class="muted tiny">剩余</span><b class="num">{{ data.goal?.remaining ?? '—' }} kg</b></div>
          </div>
        </SectionCard>

        <SectionCard title="近 7 天：摄入 vs 消耗" sub="柱状为每日摄入与总消耗，缺口看两条柱的差值">
          <Chart :option="balanceOption" height="230px" />
        </SectionCard>
      </div>

      <div class="col gap-16">
        <SectionCard title="目标完成度">
          <div v-if="data.goal" class="goal-box">
            <el-progress
              type="circle"
              :percentage="clamp(data.goal.progress, 0, 100)"
              :width="124"
              :stroke-width="10"
              color="#12a37a"
            >
              <template #default="{ percentage }">
                <div class="goal-pct num">{{ Math.round(percentage) }}%</div>
                <div class="tiny muted">已减 {{ (data.goal.startWeight - data.weight.current).toFixed(1) }} kg</div>
              </template>
            </el-progress>
            <div class="goal-facts">
              <div class="row-between"><span class="muted tiny">起始 → 目标</span><b class="num">{{ data.goal.startWeight }} → {{ data.goal.targetWeight }} kg</b></div>
              <div class="row-between"><span class="muted tiny">剩余重量</span><b class="num">{{ data.goal.remaining }} kg</b></div>
              <div class="row-between"><span class="muted tiny">剩余天数</span><b class="num">{{ data.goal.daysLeft }} 天</b></div>
              <div class="row-between"><span class="muted tiny">预测达成</span><b class="num">{{ data.goal.predictedDate }}</b></div>
            </div>
          </div>
          <EmptyState v-else icon="🎯" title="还没有设置目标" description="设定目标体重后，这里会显示进度与预测达成日期">
            <el-button type="primary" size="small" class="mt-12" @click="$router.push('/goal')">去设置目标</el-button>
          </EmptyState>
        </SectionCard>

        <SectionCard title="今日三餐" :sub="`共 ${data.intake.count} 条记录`">
          <template #extra>
            <router-link to="/diet"><el-button link type="primary">去记录</el-button></router-link>
          </template>
          <div class="meal-list">
            <div v-for="m in data.meals" :key="m.type" class="meal-row">
              <span class="meal-icon">{{ MEAL_META[m.type].icon }}</span>
              <div class="meal-main">
                <div class="row-between">
                  <span class="meal-name">{{ m.label }}</span>
                  <span class="num meal-kcal">{{ m.kcal }} <i>kcal</i></span>
                </div>
                <div class="meal-bar">
                  <div class="meal-bar-fill" :style="{ width: Math.min(100, (m.kcal / Math.max(200, data.intake.target * 0.4)) * 100) + '%', background: MEAL_META[m.type].color }" />
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="今日运动" :sub="`${data.burn.exerciseMinutes} 分钟 · ${data.burn.exercise} kcal`">
          <template #extra>
            <router-link to="/workout"><el-button link type="primary">去记录</el-button></router-link>
          </template>
          <div v-if="data.workouts.length" class="workout-list">
            <div v-for="w in data.workouts" :key="w.id" class="workout-row">
              <div class="wk-time num">{{ w.start_time }}</div>
              <div class="wk-main">
                <div class="wk-name">{{ w.name }}</div>
                <div class="tiny muted">{{ w.duration_min }} 分钟 · MET {{ w.met }}</div>
              </div>
              <div class="wk-kcal num">{{ w.kcal }}<i> kcal</i></div>
            </div>
          </div>
          <EmptyState v-else icon="🏃" title="今天还没有运动记录" :description="scheduleHint" />
        </SectionCard>
      </div>
    </div>

    <!-- 作息建议 -->
    <SectionCard title="今天可以动的时段" sub="已扣除吃饭时间，晚间不早于 18:00" class="mt-16">
      <div class="slots">
        <div v-for="s in schedule?.slots ?? []" :key="s.key" class="slot" :class="{ disabled: !s.feasible }">
          <div class="slot-head">
            <span class="slot-label">{{ s.label }}</span>
            <span class="slot-time num">{{ s.start }} – {{ s.end }}</span>
          </div>
          <div class="slot-body">
            <span class="slot-activity">{{ s.activity }}</span>
            <span class="pill pill-plain">{{ s.durationMin }} 分钟 · {{ s.kcal }} kcal</span>
          </div>
          <div class="slot-note">{{ s.feasible ? s.note : s.reason }}</div>
        </div>
      </div>
      <el-alert
        v-for="(w, i) in schedule?.warnings ?? []"
        :key="i"
        :title="w"
        type="warning"
        :closable="false"
        show-icon
        class="mt-8"
      />
    </SectionCard>
  </div>

  <el-skeleton v-else :rows="8" animated />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { MagicStick } from '@element-plus/icons-vue'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate, MEAL_META, n, prettyDate, signed, weekday, clamp } from '@/utils/format'
import { axisStyle, fmt, gridStyle, tooltipStyle } from '@/utils/chart'
import type { AdvicePayload, Dashboard, DaySchedule, StatsReport } from '@/types/api'
import Chart from '@/components/Chart.vue'
import StatCard from '@/components/StatCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import EmptyState from '@/components/EmptyState.vue'

const route = useRoute()
const store = useAppStore()
const date = computed(() => (route.query.date as string) || localDate())

const data = ref<Dashboard>()
const week = ref<StatsReport>()
const schedule = ref<DaySchedule>()
const advice = ref<AdvicePayload | null>(null)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '还没睡呢'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const hideWeight = computed(() => store.hideWeight)
const weightUnit = computed(() => store.weightUnit)
const weightText = computed(() => (hideWeight.value ? '•••' : n(data.value?.weight.current, 1)))
const weightHint = computed(() => {
  if (!data.value) return ''
  const src = data.value.weight.source === 'record' ? '今日实测' : `沿用 ${data.value.weight.from}`
  return `${src} · 趋势 ${data.value.weight.trend} kg`
})

const deficitLabel = computed(() => {
  const s = data.value?.deficit.status
  return (
    { ok: '按计划进行', in_progress: '记录中', insufficient: '待记录', excess: '有盈余', over_restrict: '摄入偏低' } as Record<string, string>
  )[s ?? 'ok'] ?? '—'
})
const deficitPill = computed(() => {
  const s = data.value?.deficit.status
  return ({ ok: 'pill-good', in_progress: 'pill-info', insufficient: 'pill-plain', excess: 'pill-warn', over_restrict: 'pill-danger' } as Record<string, string>)[s ?? 'ok']
})
const deficitTone = computed(() => {
  const s = data.value?.deficit.status
  return (s === 'over_restrict' ? 'warn' : s === 'excess' ? 'warn' : s === 'in_progress' ? 'info' : 'good') as 'warn' | 'info' | 'good'
})

const scheduleHint = computed(() => {
  const slot = schedule.value?.slots.find((s) => s.feasible && s.key === 'evening')
  return slot ? `晚间 ${slot.start}–${slot.end} 有 ${slot.durationMin} 分钟空档，可以安排 ${slot.activity}` : '按计划今天是休息日'
})

const weightOption = computed(() => {
  const series = data.value?.weight.series ?? []
  const goal = data.value?.goal?.targetWeight
  const values = series.map((p) => p.value)
  const min = Math.min(...values, goal ?? 999) - 1
  const max = Math.max(...values, goal ?? 0) + 1
  return {
    grid: gridStyle({ top: 18, bottom: 4 }),
    tooltip: { ...tooltipStyle(), formatter: (p: any) => `${p[0].axisValue}<br/>体重 <b>${p[0].data} kg</b>` },
    xAxis: { type: 'category', data: series.map((p) => p.date.slice(5)), ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: 'value', min, max, ...axisStyle(), axisLabel: { color: '#8f99a6', fontSize: 11, formatter: '{value}' } },
    series: [
      {
        type: 'line',
        data: series.map((p) => p.value),
        smooth: true,
        symbolSize: 6,
        showSymbol: series.length < 10,
        lineStyle: { width: 2.5, color: '#12a37a' },
        itemStyle: { color: '#12a37a' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(18,163,122,0.18)' },
              { offset: 1, color: 'rgba(18,163,122,0)' },
            ],
          },
        },
        markLine: goal
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.2 },
              label: { formatter: `目标 ${goal} kg`, color: '#b45309', fontSize: 11, position: 'insideEndTop' },
              data: [{ yAxis: goal }],
            }
          : undefined,
      },
    ],
  }
})

const balanceOption = computed(() => {
  const series = week.value?.series ?? []
  return {
    grid: gridStyle({ top: 28, bottom: 4 }),
    tooltip: {
      ...tooltipStyle(),
      formatter: (params: any[]) => {
        const idx = params[0].dataIndex
        const d = series[idx]
        if (!d) return ''
        return `${d.date}<br/>摄入 <b>${fmt(d.intake)}</b> kcal<br/>总消耗 <b>${fmt(d.tdee)}</b> kcal<br/>缺口 <b>${fmt(d.deficit)}</b> kcal`
      },
    },
    legend: { right: 0, top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#6c7787', fontSize: 11 } },
    xAxis: { type: 'category', data: series.map((d) => d.date.slice(5)), ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: 'value', ...axisStyle() },
    series: [
      {
        name: '摄入',
        type: 'bar',
        data: series.map((d) => d.intake),
        barWidth: 12,
        itemStyle: { color: '#12a37a', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: '总消耗',
        type: 'bar',
        data: series.map((d) => d.tdee),
        barWidth: 12,
        itemStyle: { color: '#c9d4dd', borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
})

onMounted(async () => {
  const d = date.value
  const [dash, weekStats, sched, adv] = await Promise.all([
    api.dashboard(d),
    api.stats('week', d),
    api.schedule(d),
    api.latestAdvice(d).catch(() => null),
  ])
  data.value = dash
  week.value = weekStats
  schedule.value = sched
  advice.value = adv
})
</script>

<style scoped>
.hero {
  display: flex;
  align-items: stretch;
  gap: 24px;
  padding: 22px 24px;
  background: linear-gradient(120deg, #0e1b17 0%, #14352b 55%, #0f5b46 100%);
  border: none;
  color: #ecf6f2;
  overflow: hidden;
  position: relative;
}
.hero::after {
  content: '';
  position: absolute;
  right: -60px;
  top: -80px;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(25,194,149,0.35), transparent 70%);
}
.hero-left {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}
.hero-greet {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.hero-sub {
  font-size: 12.5px;
  color: #9fc0b4;
  margin-top: 6px;
}
.hero-advice {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #d7eae2;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.09);
  padding: 10px 14px;
  border-radius: 12px;
  max-width: 720px;
}
.hero-link {
  margin-left: auto;
  color: #6ee7b7;
  font-size: 12px;
  white-space: nowrap;
}
.hero-right {
  display: flex;
  align-items: center;
  gap: 20px;
  position: relative;
  z-index: 1;
}
.score :deep(.el-progress__text) {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.score-num {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  line-height: 1.1;
}
.score-label {
  font-size: 11px;
  color: #9fc0b4;
}
.hero-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-meta-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hero-meta-row .muted {
  color: #8fb3a7;
}
.hero-meta-row b {
  color: #fff;
  font-size: 13px;
}

.dash-main {
  display: grid;
  grid-template-columns: minmax(0, 1.58fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .dash-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero {
    flex-direction: column;
  }
}

.mini-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.mini-stats div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mini-stats b {
  font-size: 14px;
}

.goal-box {
  display: flex;
  align-items: center;
  gap: 20px;
}
.goal-pct {
  font-size: 21px;
  font-weight: 700;
  color: var(--ink-900);
}
.goal-facts {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.goal-facts b {
  font-size: 13px;
}

.meal-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.meal-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.meal-icon {
  font-size: 17px;
  width: 24px;
  text-align: center;
}
.meal-main {
  flex: 1;
  min-width: 0;
}
.meal-name {
  font-size: 12.5px;
  color: var(--ink-700);
}
.meal-kcal {
  font-size: 13px;
  font-weight: 600;
}
.meal-kcal i,
.wk-kcal i {
  font-style: normal;
  font-size: 10px;
  color: var(--ink-400);
  font-weight: 400;
}
.meal-bar {
  height: 5px;
  background: #f1f4f6;
  border-radius: 4px;
  margin-top: 5px;
  overflow: hidden;
}
.meal-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.workout-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.workout-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.wk-time {
  font-size: 12px;
  color: var(--ink-500);
  background: #f4f7f8;
  padding: 3px 7px;
  border-radius: 6px;
}
.wk-main {
  flex: 1;
  min-width: 0;
}
.wk-name {
  font-size: 13px;
  font-weight: 550;
}
.wk-kcal {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-dark);
}

.slots {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 900px) {
  .slots {
    grid-template-columns: minmax(0, 1fr);
  }
}
.slot {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px;
  background: #fbfdfc;
}
.slot.disabled {
  background: #fafafa;
  opacity: 0.75;
}
.slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.slot-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--brand-dark);
}
.slot.disabled .slot-label {
  color: var(--ink-400);
}
.slot-time {
  font-size: 12px;
  color: var(--ink-700);
}
.slot-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}
.slot-activity {
  font-size: 13px;
  font-weight: 550;
}
.slot-note {
  font-size: 11.5px;
  color: var(--ink-500);
  line-height: 1.6;
  margin-top: 6px;
}
</style>
