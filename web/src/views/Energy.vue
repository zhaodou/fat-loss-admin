<template>
  <div class="energy rise">
    <div class="daybar card">
      <div class="row gap-8">
        <el-button :icon="ArrowLeft" circle size="small" @click="go(-1)" />
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 148px" @change="load" />
        <el-button :icon="ArrowRight" circle size="small" @click="go(1)" />
        <span class="pill pill-plain">{{ relativeDay(date) }}</span>
      </div>
      <div class="row gap-8">
        <span class="pill pill-info">口径：TDEE − 摄入</span>
        <router-link to="/settings"><el-button link type="primary">调整计算规则</el-button></router-link>
      </div>
    </div>

    <template v-if="data">
      <div class="grid grid-4 mt-16">
        <StatCard title="总消耗 TDEE" :value="n(data.breakdown.tdee)" unit="kcal" icon="🔥" :hint="`基础 ${n(data.breakdown.bmrPortion)} + 日常 ${n(data.breakdown.neat)} + 运动 ${n(data.breakdown.exercise)}`" />
        <StatCard title="摄入" :value="n(data.breakdown.intake)" unit="kcal" icon="🍽️" :hint="`目标 ${n(data.target.intake)} kcal`" />
        <StatCard
          title="热量缺口"
          :value="n(data.breakdown.deficit)"
          unit="kcal"
          icon="📉"
          :hint="`占 TDEE ${(data.breakdown.deficitRatio * 100).toFixed(1)}% · 计划 ${n(data.target.plannedDeficit)}`"
          :tone="data.breakdown.deficit < 0 ? 'warn' : 'good'"
        />
        <StatCard title="缺口上限" :value="n(data.target.maxDeficit)" unit="kcal" icon="🛡️" :hint="`摄入下限 ${n(data.target.floor)} kcal`" />
      </div>

      <div class="grid energy-main mt-16">
        <SectionCard title="消耗构成与缺口" sub="先算清总消耗，再谈缺口">
          <Chart :option="waterfall" height="320px" />
          <el-alert
            v-for="(note, i) in data.notes"
            :key="i"
            :title="note"
            type="info"
            :closable="false"
            show-icon
            class="mt-8"
          />
        </SectionCard>

        <SectionCard title="这个数字是怎么来的" sub="点开每一步都能对上数据">
          <div class="formula">
            <div class="fx-row">
              <span class="fx-tag">1</span>
              <div>
                <div class="fx-title">基础代谢 BMR · {{ data.formula.bmrName }}</div>
                <div class="fx-body mono">{{ data.formula.bmr }}</div>
                <div class="tiny muted">体重 {{ data.weight.value }} kg · 身高见个人资料 · 年龄按生日计算</div>
              </div>
            </div>
            <div class="fx-row">
              <span class="fx-tag">2</span>
              <div>
                <div class="fx-title">日常活动 NEAT</div>
                <div class="fx-body mono">BMR × ({{ data.formula.activityFactor }} − 1) = {{ n(data.breakdown.neat) }} kcal</div>
                <div class="tiny muted">活动水平：{{ data.formula.activityName }}，该系数<b>不含刻意运动</b></div>
              </div>
            </div>
            <div class="fx-row">
              <span class="fx-tag">3</span>
              <div>
                <div class="fx-title">运动消耗 · MET</div>
                <div class="fx-body mono">{{ data.formula.metFormula }}</div>
                <div class="tiny muted">
                  {{ data.breakdown.exerciseMinutes }} 分钟 → {{ n(data.breakdown.exercise) }} kcal；
                  运动时段已从日常消耗中按分钟剔除，<b>同一小时不会被算两次</b>
                </div>
              </div>
            </div>
            <div class="fx-row highlight">
              <span class="fx-tag">=</span>
              <div>
                <div class="fx-title">总消耗 {{ n(data.breakdown.tdee) }} kcal − 摄入 {{ n(data.breakdown.intake) }} kcal</div>
                <div class="fx-body mono">缺口 = {{ n(data.breakdown.deficit) }} kcal</div>
                <div class="tiny muted">
                  注意：如果用「基础代谢 − 摄入」会得到
                  {{ n(data.breakdown.bmrFull - data.breakdown.intake) }} kcal，这个数字虚高，因为它忽略了日常活动和运动，
                  会把正常饮食误判成严重盈余或缺口。
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div class="grid grid-2 mt-16">
        <SectionCard title="运动明细" :sub="`${data.exercises.length} 次 · ${data.breakdown.exerciseMinutes} 分钟`">
          <el-table v-if="data.exercises.length" :data="data.exercises" size="small">
            <el-table-column prop="start" label="时间" width="70" />
            <el-table-column prop="name" label="项目" min-width="120" />
            <el-table-column label="时长" width="76">
              <template #default="{ row }">{{ row.minutes }} 分钟</template>
            </el-table-column>
            <el-table-column label="MET" width="64">
              <template #default="{ row }">{{ row.met }}</template>
            </el-table-column>
            <el-table-column label="消耗" width="86" align="right">
              <template #default="{ row }"><b class="num">{{ n(row.kcal) }}</b></template>
            </el-table-column>
          </el-table>
          <EmptyState v-else icon="🛌" title="今天没有运动" description="休息日的 TDEE 只由基础代谢和日常活动构成" />
        </SectionCard>

        <SectionCard title="三大营养素" :sub="`总热量 ${n(data.macros.kcal)} kcal`">
          <div class="macro-wrap">
            <Chart :option="macroPie" height="190px" />
            <div class="macro-facts">
              <div class="mf">
                <span class="mf-dot" style="background: #12a37a" />
                <span class="mf-name">蛋白质</span>
                <b class="num">{{ data.macros.protein }} g</b>
                <span class="tiny muted">目标 {{ data.macros.targetProtein }} g</span>
              </div>
              <div class="mf">
                <span class="mf-dot" style="background: #3b82f6" />
                <span class="mf-name">碳水</span>
                <b class="num">{{ data.macros.carb }} g</b>
                <span class="tiny muted">{{ data.macros.ratio.carb }}%</span>
              </div>
              <div class="mf">
                <span class="mf-dot" style="background: #f59e0b" />
                <span class="mf-name">脂肪</span>
                <b class="num">{{ data.macros.fat }} g</b>
                <span class="tiny muted">{{ data.macros.ratio.fat }}%</span>
              </div>
              <div class="mf">
                <span class="mf-dot" style="background: #94a3b8" />
                <span class="mf-name">纤维</span>
                <b class="num">{{ data.macros.fiber }} g</b>
                <span class="tiny muted">建议 25 g+</span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="近 7 天缺口走势" sub="柱状为实际缺口，橙色虚线为计划缺口" class="mt-16">
        <Chart :option="weekOption" height="240px" />
      </SectionCard>
    </template>
    <el-skeleton v-else :rows="8" animated class="mt-16" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api } from '@/api'
import { localDate, n, relativeDay, shift } from '@/utils/format'
import { axisStyle, gridStyle, tooltipStyle } from '@/utils/chart'
import type { EnergyAnalysis, StatsReport } from '@/types/api'
import StatCard from '@/components/StatCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import Chart from '@/components/Chart.vue'

const date = ref(localDate())
const data = ref<EnergyAnalysis>()
const week = ref<StatsReport>()

const waterfall = computed(() => {
  const b = data.value!.breakdown
  const items = [
    { name: '基础代谢', start: 0, value: b.bmrPortion, color: '#12a37a' },
    { name: '日常活动', start: b.bmrPortion, value: b.neat, color: '#3b82f6' },
    { name: '运动', start: b.bmrPortion + b.neat, value: b.exercise, color: '#f59e0b' },
    { name: '总消耗', start: 0, value: b.tdee, color: '#0e1b17' },
    { name: '摄入', start: b.tdee - b.intake, value: b.intake, color: '#a855f7' },
    { name: '缺口', start: 0, value: Math.abs(b.deficit), color: b.deficit >= 0 ? '#12a37a' : '#ef4444' },
  ]
  return {
    grid: gridStyle({ top: 34, bottom: 4 }),
    tooltip: {
      ...tooltipStyle(),
      formatter: (p: any[]) => {
        const i = p[0].dataIndex
        const it = items[i]
        return `<b>${it.name}</b><br/>${n(it.value)} kcal`
      },
    },
    xAxis: {
      type: 'category',
      data: items.map((i) => i.name),
      ...axisStyle(),
      splitLine: { show: false },
      axisLabel: { color: '#6c7787', fontSize: 11 },
    },
    yAxis: { type: 'value', ...axisStyle() },
    series: [
      {
        type: 'bar',
        stack: 'water',
        silent: true,
        data: items.map((i) => i.start),
        itemStyle: { color: 'transparent' },
        barWidth: 36,
      },
      {
        type: 'bar',
        stack: 'water',
        data: items.map((i) => ({ value: i.value, itemStyle: { color: i.color, borderRadius: [4, 4, 0, 0] } })),
        label: {
          show: true,
          position: 'top',
          formatter: (p: any) => (p.value ? n(p.value) : ''),
          color: '#3c4653',
          fontSize: 10.5,
          fontWeight: 600,
        },
      },
    ],
  }
})

const macroPie = computed(() => {
  const m = data.value!.macros
  return {
    tooltip: { trigger: 'item', backgroundColor: 'rgba(19,26,34,0.92)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } },
    color: ['#12a37a', '#3b82f6', '#f59e0b'],
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '50%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: [
          { name: '蛋白质', value: Math.round(m.ratio.protein) },
          { name: '碳水', value: Math.round(m.ratio.carb) },
          { name: '脂肪', value: Math.round(m.ratio.fat) },
        ],
      },
    ],
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: 'center',
        style: { text: `${m.ratio.protein}%`, fontSize: 18, fontWeight: 700, fill: '#131a22' },
      },
    ],
  }
})

const weekOption = computed(() => {
  const series = week.value?.series ?? []
  const planned = data.value?.target.plannedDeficit ?? 0
  return {
    grid: gridStyle({ top: 28 }),
    tooltip: { ...tooltipStyle(), formatter: (p: any[]) => `${p[0].axisValue}<br/>缺口 <b>${n(p[0].data)}</b> kcal` },
    xAxis: { type: 'category', data: series.map((s) => s.date.slice(5)), ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: 'value', ...axisStyle() },
    series: [
      {
        type: 'bar',
        data: series.map((s) => s.deficit),
        barWidth: 18,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: (p: any) => (p.value >= 0 ? '#12a37a' : '#ef4444'),
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.4 },
          label: { formatter: `计划 ${planned}`, color: '#b45309', fontSize: 10, position: 'insideEndTop' },
          data: [{ yAxis: planned }],
        },
      },
    ],
  }
})

async function load() {
  const [e, s] = await Promise.all([api.energy(date.value), api.stats('week', date.value)])
  data.value = e
  week.value = s
}

function go(delta: number) {
  date.value = shift(date.value, delta)
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
.energy-main {
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: start;
}
@media (max-width: 1100px) {
  .energy-main {
    grid-template-columns: minmax(0, 1fr);
  }
}
.formula {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.fx-row {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfcfc;
}
.fx-row.highlight {
  background: var(--brand-soft);
  border-color: var(--brand-line);
}
.fx-tag {
  flex: 0 0 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-dark);
}
.fx-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-900);
}
.fx-body {
  font-size: 11.5px;
  color: var(--ink-700);
  margin: 4px 0 3px;
  line-height: 1.7;
  word-break: break-all;
}
.macro-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.macro-wrap > :first-child {
  flex: 0 0 45%;
}
.macro-facts {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mf {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.mf-dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
.mf-name {
  color: var(--ink-700);
  width: 40px;
}
.mf b {
  font-size: 13.5px;
}
</style>
