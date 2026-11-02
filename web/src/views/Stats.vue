<template>
  <div class="stats rise">
    <div class="daybar card">
      <div class="row gap-8">
        <el-radio-group v-model="granularity" size="default" @change="onGranularity">
          <el-radio-button value="week">近 7 天</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="year">今年</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-model="date"
          :type="granularity === 'year' ? 'year' : granularity === 'month' ? 'month' : 'date'"
          :value-format="granularity === 'year' ? 'YYYY' : granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'"
          :clearable="false"
          style="width: 140px"
          @change="load"
        />
      </div>
      <span class="pill pill-plain" v-if="data">{{ data.start }} ~ {{ data.end }}</span>
    </div>

    <template v-if="data">
      <div class="grid grid-4 mt-16">
        <StatCard
          title="体重变化"
          :value="data.summary.weightChange === null ? '—' : signed(data.summary.weightChange, 1)"
          unit="kg"
          icon="⚖️"
          :hint="`${data.summary.weightStart ?? '—'} → ${data.summary.weightEnd ?? '—'} kg`"
          :tone="(data.summary.weightChange ?? 0) < 0 ? 'good' : 'warn'"
        />
        <StatCard
          title="日均缺口"
          :value="n(data.summary.avgDeficit)"
          unit="kcal"
          icon="🔥"
          :hint="`累计 ${n(data.summary.totalDeficit)} kcal ≈ ${(data.summary.totalDeficit / 7700).toFixed(2)} kg 脂肪`"
          tone="info"
        />
        <StatCard
          title="运动"
          :value="data.summary.workoutDays"
          unit="天"
          icon="🏃"
          :hint="`${data.summary.totalExerciseMin} 分钟 · ${n(data.summary.totalExerciseKcal)} kcal`"
        />
        <StatCard
          title="记录覆盖"
          :value="data.summary.loggedDays"
          unit="天"
          icon="📝"
          :hint="`共 ${data.summary.days} 天 · 覆盖率 ${Math.round((data.summary.loggedDays / Math.max(1, data.summary.days)) * 100)}%`"
        />
      </div>

      <div class="compare card mt-12">
        <span class="tiny muted">与上一周期对比</span>
        <div class="cmp" v-for="c in compares" :key="c.label">
          <span class="cmp-label">{{ c.label }}</span>
          <b class="num" :class="c.tone">{{ c.value }}</b>
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <SectionCard title="体重走势" :sub="granularity === 'year' ? '每月末体重' : '每日实测体重'">
          <Chart :option="weightOption" height="250px" />
        </SectionCard>
        <SectionCard title="摄入 vs 总消耗" sub="灰柱为 TDEE，绿柱为摄入">
          <Chart :option="balanceOption" height="250px" />
        </SectionCard>
        <SectionCard title="热量缺口" :sub="'柱状为缺口，红色表示盈余'">
          <Chart :option="deficitOption" height="250px" />
        </SectionCard>
        <SectionCard title="运动时长" :sub="granularity === 'year' ? '每月总时长' : '每日时长'">
          <Chart :option="exerciseOption" height="250px" />
        </SectionCard>
      </div>

      <div class="grid grid-2 mt-16">
        <SectionCard title="饮食结构" :sub="`蛋白 ${data.summary.macroRatio.protein}% · 碳水 ${data.summary.macroRatio.carb}% · 脂肪 ${data.summary.macroRatio.fat}%`">
          <Chart :option="macroOption" height="240px" />
        </SectionCard>
        <SectionCard title="目标完成情况">
          <div v-if="data.goal" class="goal">
            <div class="row-between"><span class="tiny muted">目标体重</span><b class="num">{{ data.goal.targetWeight }} kg</b></div>
            <div class="row-between"><span class="tiny muted">起始体重</span><b class="num">{{ data.goal.startWeight }} kg</b></div>
            <div class="row-between"><span class="tiny muted">当前</span><b class="num">{{ data.summary.weightEnd ?? '—' }} kg</b></div>
            <div class="row-between"><span class="tiny muted">目标日期</span><b class="num">{{ data.goal.targetDate }}</b></div>
            <el-progress :percentage="Math.min(100, Math.max(0, data.goal.progress))" :stroke-width="8" color="#12a37a" class="mt-12" />
            <div class="tiny muted mt-4">已完成 {{ data.goal.progress }}%</div>
          </div>
          <EmptyState v-else icon="🎯" title="还没有设置目标" />
          <div class="divider" />
          <div class="side-facts">
            <div><span class="tiny muted">蛋白质总量</span><b class="num">{{ n(data.summary.protein) }} g</b></div>
            <div><span class="tiny muted">碳水总量</span><b class="num">{{ n(data.summary.carb) }} g</b></div>
            <div><span class="tiny muted">脂肪总量</span><b class="num">{{ n(data.summary.fat) }} g</b></div>
            <div><span class="tiny muted">日均摄入</span><b class="num">{{ n(data.summary.avgIntake) }} kcal</b></div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="分区间明细" class="mt-16">
        <el-table :data="data.buckets" size="small" max-height="360">
          <el-table-column prop="label" label="区间" width="110" />
          <el-table-column label="日均摄入" width="110" align="right">
            <template #default="{ row }">{{ n(row.avgIntake) }}</template>
          </el-table-column>
          <el-table-column label="日均消耗" width="110" align="right">
            <template #default="{ row }">{{ n(row.avgTdee) }}</template>
          </el-table-column>
          <el-table-column label="日均缺口" width="110" align="right">
            <template #default="{ row }">
              <span :class="row.avgDeficit >= 0 ? 'tone-good' : 'tone-danger'">{{ signed(row.avgDeficit, 0) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="体重变化" width="110" align="right">
            <template #default="{ row }">{{ row.weightChange === null ? '—' : signed(row.weightChange, 1) + ' kg' }}</template>
          </el-table-column>
          <el-table-column label="运动" width="110">
            <template #default="{ row }">{{ row.workoutDays }} 天 / {{ row.exerciseMin }} 分钟</template>
          </el-table-column>
          <el-table-column label="记录" min-width="90">
            <template #default="{ row }">{{ row.loggedDays }} 天</template>
          </el-table-column>
        </el-table>
      </SectionCard>
    </template>
    <el-skeleton v-else :rows="8" animated class="mt-16" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/api'
import { localDate, n, signed } from '@/utils/format'
import { axisStyle, gridStyle, palette, tooltipStyle } from '@/utils/chart'
import type { StatsReport } from '@/types/api'
import StatCard from '@/components/StatCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import Chart from '@/components/Chart.vue'
import EmptyState from '@/components/EmptyState.vue'

const granularity = ref<'week' | 'month' | 'year'>('week')
const date = ref(localDate())
const data = ref<StatsReport>()

const rows = computed(() => {
  const r = data.value
  if (!r) return []
  if (r.granularity === 'year') {
    return r.buckets.map((b) => ({
      label: b.label,
      intake: b.avgIntake,
      tdee: b.avgTdee,
      deficit: b.avgDeficit,
      weight: b.weightEnd,
      minutes: b.exerciseMin,
      days: b.workoutDays,
    }))
  }
  return r.series.map((s) => ({
    label: s.date.slice(5),
    intake: s.intake,
    tdee: s.tdee,
    deficit: s.deficit,
    weight: s.weight,
    minutes: s.exerciseMin,
    days: s.exerciseMin > 0 ? 1 : 0,
  }))
})

const compares = computed(() => {
  const c = data.value?.compare
  if (!c) return []
  return [
    { label: '日均摄入', value: signed(c.intake, 0) + ' kcal', tone: c.intake <= 0 ? 'tone-good' : 'tone-warn' },
    { label: '日均缺口', value: signed(c.deficit, 0) + ' kcal', tone: c.deficit >= 0 ? 'tone-good' : 'tone-warn' },
    { label: '运动时长', value: signed(c.exerciseMin, 0) + ' 分钟', tone: c.exerciseMin >= 0 ? 'tone-good' : 'tone-warn' },
    { label: '体重变化', value: signed(c.weightChange, 1) + ' kg', tone: c.weightChange <= 0 ? 'tone-good' : 'tone-warn' },
  ]
})

const weightOption = computed(() => ({
  grid: gridStyle({ top: 20 }),
  tooltip: { ...tooltipStyle(), formatter: (p: any[]) => `${p[0].axisValue}<br/>体重 <b>${p[0].data ?? '—'}</b> kg` },
  xAxis: { type: 'category', data: rows.value.map((r) => r.label), ...axisStyle(), splitLine: { show: false }, boundaryGap: false },
  yAxis: { type: 'value', scale: true, ...axisStyle() },
  series: [
    {
      type: 'line',
      data: rows.value.map((r) => r.weight),
      smooth: true,
      connectNulls: true,
      symbolSize: (v: any) => (v === null ? 0 : 5),
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
    },
  ],
}))

const balanceOption = computed(() => ({
  grid: gridStyle({ top: 28 }),
  tooltip: {
    ...tooltipStyle(),
    formatter: (p: any[]) => `${p[0].axisValue}<br/>${p.map((x) => `${x.marker}${x.seriesName} <b>${n(x.data)}</b>`).join('<br/>')}`,
  },
  legend: { right: 0, top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#6c7787', fontSize: 11 } },
  xAxis: { type: 'category', data: rows.value.map((r) => r.label), ...axisStyle(), splitLine: { show: false } },
  yAxis: { type: 'value', ...axisStyle() },
  series: [
    { name: '摄入', type: 'bar', data: rows.value.map((r) => r.intake), barWidth: 10, itemStyle: { color: '#12a37a', borderRadius: [3, 3, 0, 0] } },
    { name: '总消耗', type: 'bar', data: rows.value.map((r) => r.tdee), barWidth: 10, itemStyle: { color: '#d3dce3', borderRadius: [3, 3, 0, 0] } },
  ],
}))

const deficitOption = computed(() => ({
  grid: gridStyle({ top: 20 }),
  tooltip: { ...tooltipStyle(), formatter: (p: any[]) => `${p[0].axisValue}<br/>缺口 <b>${n(p[0].data)}</b> kcal` },
  xAxis: { type: 'category', data: rows.value.map((r) => r.label), ...axisStyle(), splitLine: { show: false } },
  yAxis: { type: 'value', ...axisStyle() },
  series: [
    {
      type: 'bar',
      data: rows.value.map((r) => r.deficit),
      barWidth: 10,
      itemStyle: { borderRadius: [3, 3, 0, 0], color: (p: any) => (p.value >= 0 ? '#12a37a' : '#ef4444') },
    },
  ],
}))

const exerciseOption = computed(() => ({
  grid: gridStyle({ top: 20 }),
  tooltip: { ...tooltipStyle(), formatter: (p: any[]) => `${p[0].axisValue}<br/>运动 <b>${p[0].data}</b> 分钟` },
  xAxis: { type: 'category', data: rows.value.map((r) => r.label), ...axisStyle(), splitLine: { show: false } },
  yAxis: { type: 'value', ...axisStyle() },
  series: [
    {
      type: 'bar',
      data: rows.value.map((r) => r.minutes),
      barWidth: 10,
      itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] },
    },
  ],
}))

const macroOption = computed(() => {
  const m = data.value?.summary.macroRatio ?? { protein: 0, carb: 0, fat: 0 }
  return {
    tooltip: { trigger: 'item', backgroundColor: 'rgba(19,26,34,0.92)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } },
    legend: { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: '#6c7787', fontSize: 11 } },
    color: palette,
    series: [
      {
        type: 'pie',
        radius: ['48%', '70%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: [
          { name: '蛋白质', value: m.protein },
          { name: '碳水', value: m.carb },
          { name: '脂肪', value: m.fat },
        ],
      },
    ],
  }
})

async function load() {
  data.value = await api.stats(granularity.value, date.value)
}

/** 切换粒度时把日期重排成对应格式，否则选择器会拿到不匹配的值 */
function onGranularity() {
  const d = localDate()
  date.value = granularity.value === 'year' ? d.slice(0, 4) : granularity.value === 'month' ? d.slice(0, 7) : d
  load()
}

onMounted(load)
</script>

<style scoped>
.daybar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}
.compare {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 18px;
  flex-wrap: wrap;
}
.cmp {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cmp-label {
  font-size: 12px;
  color: var(--ink-500);
}
.cmp b {
  font-size: 13px;
}
.goal {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.side-facts div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.side-facts b {
  font-size: 13.5px;
}
</style>
