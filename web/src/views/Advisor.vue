<template>
  <div class="advisor rise">
    <div class="daybar card">
      <div class="row gap-8">
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 148px" />
        <span class="pill pill-plain">{{ relativeDay(date) }}</span>
        <span v-if="advice" class="pill pill-info">引擎 {{ advice.engine }}</span>
      </div>
      <el-button type="primary" :icon="MagicStick" :loading="loading" @click="generate">
        {{ advice ? '重新生成建议' : '生成建议' }}
      </el-button>
    </div>

    <template v-if="advice">
      <section class="headline card">
        <div class="hl-left">
          <div class="row gap-8">
            <span class="pill" :class="scorePill">{{ levelText }}</span>
            <span class="tiny muted">基于近 {{ advice.metrics.windowDays }} 天数据 · {{ advice.metrics.weightPoints }} 条体重记录 · {{ advice.metrics.loggedDietDays }} 天饮食</span>
          </div>
          <h2 class="hl-title">{{ advice.headline }}</h2>
          <p class="hl-summary">{{ advice.summary }}</p>
          <div v-if="advice.nextActions.length" class="hl-actions">
            <span class="tiny muted">优先做这 {{ advice.nextActions.length }} 件事</span>
            <div v-for="(a, i) in advice.nextActions" :key="i" class="hl-action">
              <span class="idx">{{ i + 1 }}</span>{{ a }}
            </div>
          </div>
        </div>
        <div class="hl-score">
          <el-progress type="dashboard" :percentage="advice.score" :width="132" :stroke-width="9" :color="scoreColor">
            <template #default="{ percentage }">
              <div class="score-big num">{{ Math.round(percentage) }}</div>
              <div class="tiny muted">执行分</div>
            </template>
          </el-progress>
          <div class="tiny muted">生成于 {{ advice.generatedAt.slice(11, 16) }}</div>
        </div>
      </section>

      <div class="grid grid-4 mt-16">
        <StatCard
          title="14 天体重趋势"
          :value="signed(advice.metrics.weeklyChange14, 2)"
          unit="kg/周"
          icon="📉"
          :hint="`28 天 ${signed(advice.metrics.weeklyChange28, 2)} kg/周`"
          :tone="advice.metrics.weeklyChange14 <= -0.2 && advice.metrics.weeklyChange14 >= -1.2 ? 'good' : 'warn'"
        />
        <StatCard
          title="平均缺口"
          :value="n(advice.metrics.avgDeficit14)"
          unit="kcal"
          icon="🔥"
          :hint="`目标 ${n(advice.metrics.plannedDeficit)} · 完成 ${Math.round((advice.metrics.avgDeficit14 / Math.max(1, advice.metrics.plannedDeficit)) * 100)}%`"
          tone="info"
        />
        <StatCard
          title="日均摄入"
          :value="n(advice.metrics.avgIntake14)"
          unit="kcal"
          icon="🍽️"
          :hint="`目标 ${n(advice.metrics.targetIntake)} kcal`"
        />
        <StatCard
          title="蛋白质"
          :value="advice.metrics.proteinAvg"
          unit="g"
          icon="🥚"
          :hint="`目标 ${advice.metrics.proteinTarget} g`"
          :tone="advice.metrics.proteinAvg >= advice.metrics.proteinTarget * 0.8 ? 'good' : 'warn'"
        />
      </div>

      <div class="grid advisor-main mt-16">
        <div class="col gap-16">
          <SectionCard title="建议清单" :sub="`${advice.advices.length} 条，按优先级排序`">
            <div class="advice-list">
              <AdviceCard v-for="a in advice.advices" :key="a.id" :advice="a" />
            </div>
          </SectionCard>

          <SectionCard title="未来 7 天训练安排" sub="结合你的上下班时间生成，休息日也标出来了">
            <div class="week-table">
              <div v-for="d in advice.weekPlan" :key="d.date" class="week-row" :class="{ rest: !d.isWorkoutDay }">
                <div class="wk-date">
                  <b>{{ d.date.slice(5).replace('-', '/') }}</b>
                  <span class="tiny muted">{{ weekdayName(d.weekday) }}</span>
                </div>
                <span class="pill" :class="d.isWorkoutDay ? 'pill-good' : 'pill-plain'">{{ d.focus }}</span>
                <div class="wk-slots">
                  <span v-for="s in d.slots" :key="s.key" class="wk-slot">
                    {{ s.start }}–{{ s.end }} {{ s.activity }} <i>{{ s.kcal }} kcal</i>
                  </span>
                  <span v-if="!d.slots.length" class="tiny muted">无可安排时段</span>
                </div>
                <div class="wk-kcal num">{{ d.plannedKcal }}<i> kcal</i></div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div class="col gap-16">
          <SectionCard title="今日时段" sub="午休扣除吃饭时间，晚间 ≥18:00">
            <div class="timeline">
              <div v-for="s in advice.schedule.slots" :key="s.key" class="tl-row" :class="{ off: !s.feasible }">
                <div class="tl-time num">{{ s.start }}<span>{{ s.end }}</span></div>
                <div class="tl-dot" :class="{ off: !s.feasible }" />
                <div class="tl-body">
                  <div class="row-between">
                    <span class="tl-act">{{ s.activity }}</span>
                    <span class="tiny num muted">{{ s.kcal }} kcal</span>
                  </div>
                  <div class="tiny muted">{{ s.feasible ? `${s.durationMin} 分钟 · ${s.note}` : s.reason }}</div>
                </div>
              </div>
            </div>
            <div class="meal-window tiny muted mt-8">
              午餐时段 {{ advice.schedule.mealWindow.start }}–{{ advice.schedule.mealWindow.end }}（{{ advice.schedule.mealWindow.minutes }} 分钟）只用来吃饭
            </div>
          </SectionCard>

          <SectionCard title="目标评估">
            <div v-if="advice.goal" class="goal-eval">
              <div class="row-between"><span class="tiny muted">目标体重</span><b class="num">{{ advice.goal.targetWeight }} kg</b></div>
              <div class="row-between"><span class="tiny muted">系统建议</span><b class="num">{{ advice.goal.recommendedWeight }} kg</b></div>
              <div class="row-between"><span class="tiny muted">健康区间</span><b class="num">{{ advice.goal.healthyRange.min }}–{{ advice.goal.healthyRange.max }} kg</b></div>
              <div class="row-between"><span class="tiny muted">目标日期</span><b class="num">{{ advice.goal.targetDate }}</b></div>
              <div class="row-between"><span class="tiny muted">预测达成</span><b class="num" :class="advice.goal.predictedDate > advice.goal.targetDate ? 'tone-warn' : 'tone-good'">{{ advice.goal.predictedDate }}</b></div>
              <div class="row-between"><span class="tiny muted">剩余天数</span><b class="num">{{ advice.goal.daysLeft }} 天</b></div>
              <el-progress :percentage="Math.min(100, Math.max(0, advice.goal.progress))" :stroke-width="7" color="#12a37a" class="mt-8" />
              <div class="tiny muted mt-4">进度 {{ advice.goal.progress }}%</div>
            </div>
            <EmptyState v-else icon="🎯" title="还没有目标" description="设置目标后可以评估可行性" />
          </SectionCard>

          <SectionCard title="分析边界" sub="这些约束保证建议不会跑偏">
            <ul class="guard">
              <li v-for="(g, i) in advice.guardrails" :key="i">{{ g }}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </template>

    <div v-else class="empty-wrap card mt-16">
      <EmptyState
        icon="🤖"
        title="还没有生成分析"
        description="点击右上角生成建议。系统会读取近 28 天的体重、饮食、运动数据，逐条给出可执行建议，并标明依据。"
      >
        <el-button type="primary" class="mt-12" :loading="loading" @click="generate">立即生成</el-button>
      </EmptyState>
    </div>

    <SectionCard v-if="history.length" title="历史分析" class="mt-16">
      <el-timeline>
        <el-timeline-item v-for="h in history" :key="h.id" :timestamp="`${h.date} · 评分 ${h.score}`" placement="top">
          {{ h.headline }}
        </el-timeline-item>
      </el-timeline>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MagicStick } from '@element-plus/icons-vue'
import { api } from '@/api'
import { localDate, n, relativeDay, signed } from '@/utils/format'
import type { AdvicePayload } from '@/types/api'
import StatCard from '@/components/StatCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import AdviceCard from '@/components/AdviceCard.vue'
import EmptyState from '@/components/EmptyState.vue'

const date = ref(localDate())
const advice = ref<AdvicePayload | null>(null)
const history = ref<any[]>([])
const loading = ref(false)

const levelText = computed(() => {
  const map: Record<string, string> = { excellent: '执行优秀', good: '状态良好', fair: '需要微调', needs_attention: '优先止损' }
  return map[advice.value?.level ?? ''] ?? '分析完成'
})
const scoreColor = computed(() => {
  const s = advice.value?.score ?? 0
  if (s >= 85) return '#12a37a'
  if (s >= 70) return '#3b82f6'
  if (s >= 50) return '#f59e0b'
  return '#ef4444'
})
const scorePill = computed(() => {
  const s = advice.value?.score ?? 0
  if (s >= 85) return 'pill-good'
  if (s >= 70) return 'pill-info'
  if (s >= 50) return 'pill-warn'
  return 'pill-danger'
})

const weekdayName = (w: number) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][w]

async function generate() {
  loading.value = true
  try {
    advice.value = await api.generateAdvice(date.value)
    history.value = await api.adviceHistory()
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  advice.value = await api.latestAdvice(date.value)
  history.value = await api.adviceHistory()
})
</script>

<style scoped>
.daybar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}
.headline {
  margin-top: 16px;
  display: flex;
  gap: 24px;
  padding: 22px 24px;
  align-items: center;
  background: linear-gradient(115deg, #ffffff 0%, #f6fbf9 60%, #eef9f4 100%);
  border-color: var(--brand-line);
}
.hl-left {
  flex: 1;
  min-width: 0;
}
.hl-title {
  font-size: 20px;
  font-weight: 700;
  margin: 10px 0 6px;
  letter-spacing: -0.3px;
}
.hl-summary {
  font-size: 13px;
  color: var(--ink-700);
  line-height: 1.8;
  margin: 0;
  max-width: 760px;
}
.hl-actions {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hl-action {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-700);
}
.idx {
  flex: 0 0 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 10px;
  display: grid;
  place-items: center;
  font-weight: 700;
  margin-top: 1px;
}
.hl-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.score-big {
  font-size: 30px;
  font-weight: 700;
  color: var(--ink-900);
  line-height: 1.1;
}
.advisor-main {
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  align-items: start;
}
@media (max-width: 1100px) {
  .advisor-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .headline {
    flex-direction: column;
    align-items: flex-start;
  }
}
.advice-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.week-table {
  display: flex;
  flex-direction: column;
}
.week-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f4f6;
}
.week-row:last-child {
  border-bottom: none;
}
.week-row.rest {
  opacity: 0.8;
}
.wk-date {
  width: 58px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.wk-date b {
  font-size: 12.5px;
}
.wk-slots {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.wk-slot {
  font-size: 11.5px;
  color: var(--ink-700);
  background: #f5f8f7;
  padding: 2px 7px;
  border-radius: 6px;
}
.wk-slot i {
  font-style: normal;
  color: var(--ink-400);
}
.wk-kcal {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--brand-dark);
}
.wk-kcal i {
  font-style: normal;
  font-size: 10px;
  font-weight: 400;
  color: var(--ink-400);
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tl-row {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  position: relative;
}
.tl-row.off {
  opacity: 0.6;
}
.tl-time {
  width: 66px;
  font-size: 11.5px;
  color: var(--ink-700);
  display: flex;
  flex-direction: column;
}
.tl-time span {
  color: var(--ink-400);
}
.tl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  margin-top: 4px;
  flex: 0 0 8px;
}
.tl-dot.off {
  background: var(--ink-300);
}
.tl-body {
  flex: 1;
  min-width: 0;
}
.tl-act {
  font-size: 12.5px;
  font-weight: 600;
}
.goal-eval {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.guard {
  margin: 0;
  padding-left: 16px;
}
.guard li {
  font-size: 11.5px;
  color: var(--ink-600, #4b5563);
  line-height: 1.8;
  margin-bottom: 4px;
}
.empty-wrap {
  padding: 24px;
}
</style>
