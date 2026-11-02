<template>
  <div class="body rise">
    <div class="daybar card">
      <div class="row gap-8">
        <span class="tiny muted">统计区间</span>
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :value="30">30 天</el-radio-button>
          <el-radio-button :value="90">90 天</el-radio-button>
          <el-radio-button :value="365">1 年</el-radio-button>
        </el-radio-group>
      </div>
      <div class="row gap-8">
        <span class="pill pill-plain">健康区间 {{ data?.healthyRange.min }}–{{ data?.healthyRange.max }} kg</span>
        <el-button type="primary" :icon="Plus" @click="openForm()">记录身体数据</el-button>
      </div>
    </div>

    <template v-if="data">
      <div class="grid grid-4 mt-16">
        <StatCard
          title="当前体重"
          :value="hideWeight ? '•••' : n(currentWeight, 1)"
          unit="kg"
          icon="⚖️"
          :hint="`实测区间 ${data.stats.min}–${data.stats.max} kg`"
        />
        <StatCard
          title="趋势体重（7 日平滑）"
          :value="hideWeight ? '•••' : n(data.trendWeight, 1)"
          unit="kg"
          icon="📈"
          :hint="`较 30 天前 ${signed(weightDelta, 1)} kg`"
          tone="good"
        />
        <StatCard
          title="周变化速度"
          :value="signed(data.weeklyChange, 2)"
          unit="kg/周"
          icon="⏱️"
          :hint="paceHint"
          :tone="data.weeklyChange < -1.2 ? 'warn' : 'good'"
        />
        <StatCard
          title="BMI"
          :value="data.stats.bmi ?? '—'"
          icon="🧮"
          :hint="bmiHint"
          :tone="bmiTone"
        />
      </div>

      <div class="grid body-main mt-16">
        <SectionCard title="体重曲线" sub="浅色为实测，绿色为 7 日平滑趋势，橙色虚线为目标">
          <Chart :option="weightOption" height="320px" />
        </SectionCard>

        <SectionCard title="身体成分记录" sub="体重之外，腰围和体脂更能说明问题">
          <el-form label-width="64px" label-position="top">
            <div class="grid grid-2" style="gap: 10px">
              <el-form-item label="日期">
                <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
              </el-form-item>
              <el-form-item label="体重 kg">
                <el-input-number v-model="form.weight_kg" :min="30" :max="200" :step="0.1" :precision="1" style="width: 100%" />
              </el-form-item>
              <el-form-item label="腰围 cm">
                <el-input-number v-model="form.waist_cm" :min="40" :max="160" :step="0.1" :precision="1" style="width: 100%" />
              </el-form-item>
              <el-form-item label="体脂率 %">
                <el-input-number v-model="form.body_fat_pct" :min="3" :max="60" :step="0.1" :precision="1" style="width: 100%" />
              </el-form-item>
              <el-form-item label="肌肉量 kg">
                <el-input-number v-model="form.muscle_kg" :min="5" :max="120" :step="0.1" :precision="1" style="width: 100%" />
              </el-form-item>
            </div>
            <el-form-item label="备注">
              <el-input v-model="form.note" placeholder="晨起空腹 / 训练后 / 经期" />
            </el-form-item>
            <el-button type="primary" class="w-full" :loading="saving" @click="save">保存记录</el-button>
          </el-form>
          <div class="forecast">
            <div class="row-between">
              <span class="tiny muted">按当前趋势预测 30 天后</span>
              <b class="num forecast-num">{{ data.forecast30 ?? '—' }} kg</b>
            </div>
            <div class="tiny muted mt-4">
              拟合优度 R² = {{ data.r2 }}，基于 {{ data.series.length }} 条体重记录
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="记录明细" :sub="`共 ${data.records.length} 条`" class="mt-16">
        <el-table :data="[...data.records].reverse()" size="small" height="320">
          <el-table-column prop="date" label="日期" width="110" />
          <el-table-column label="体重" width="90">
            <template #default="{ row }">{{ row.weight_kg ?? '—' }} kg</template>
          </el-table-column>
          <el-table-column label="腰围" width="90">
            <template #default="{ row }">{{ row.waist_cm ?? '—' }} cm</template>
          </el-table-column>
          <el-table-column label="体脂率" width="90">
            <template #default="{ row }">{{ row.body_fat_pct ?? '—' }} %</template>
          </el-table-column>
          <el-table-column label="肌肉量" width="90">
            <template #default="{ row }">{{ row.muscle_kg ?? '—' }} kg</template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="120" />
          <el-table-column label="操作" width="80" align="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="remove(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </SectionCard>

      <SectionCard title="体型照片（正面 / 侧面 / 背面）" sub="电子秤称重后上传，便于后续对比身体变化" class="mt-16">
        <div class="row gap-8 mb-12">
          <span class="tiny muted">照片日期</span>
          <el-date-picker v-model="photoDate" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 170px" />
        </div>
        <div class="photo-slots">
          <div v-for="v in (['front', 'side', 'back'] as const)" :key="v" class="photo-slot">
            <div class="photo-slot-head">
              <span class="photo-slot-title">{{ VIEW_LABEL[v] }}</span>
              <el-upload :show-file-list="false" :http-request="(opt: any) => doUpload(v, opt)" accept="image/*">
                <el-button size="small" :loading="uploading[v]">{{ photoFor(v) ? '替换' : '上传' }}</el-button>
              </el-upload>
            </div>
            <div class="photo-slot-body">
              <el-image v-if="photoFor(v)" :src="photoFor(v)!.url" :preview-src-list="[photoFor(v)!.url]" fit="cover" class="photo-thumb" preview-teleported>
                <template #error><div class="photo-empty">加载失败</div></template>
              </el-image>
              <div v-else class="photo-empty">未上传</div>
              <el-button v-if="photoFor(v)" link type="danger" size="small" class="photo-del" @click="removePhoto(photoFor(v)!.id)">删除</el-button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="体型变化对比" sub="选单一视角跨日期横向对比，或查看每日三视角快照" class="mt-16">
        <el-radio-group v-model="compareView" size="small" class="mb-12">
          <el-radio-button value="front">正面</el-radio-button>
          <el-radio-button value="side">侧面</el-radio-button>
          <el-radio-button value="back">背面</el-radio-button>
        </el-radio-group>
        <div v-if="comparePhotos.length" class="compare-scroll">
          <div v-for="p in comparePhotos" :key="p.id" class="compare-item">
            <el-image :src="p.url" :preview-src-list="comparePhotos.map((x) => x.url)" :initial-index="comparePhotos.indexOf(p)" fit="cover" class="compare-thumb" preview-teleported />
            <div class="compare-date">{{ p.date.slice(5) }}</div>
          </div>
        </div>
        <el-empty v-else description="还没有该视角的照片" :image-size="56" />

        <div class="tiny muted mt-16">每日快照</div>
        <div v-if="dateGroups.length" class="date-groups">
          <div v-for="[date, list] in dateGroups" :key="date" class="date-group">
            <div class="date-group-title">{{ date }}</div>
            <div class="date-group-imgs">
              <el-image v-for="p in list" :key="p.id" :src="p.url" :preview-src-list="list.map((x) => x.url)" :initial-index="list.indexOf(p)" fit="cover" class="date-thumb" preview-teleported>
                <template #error><div class="photo-empty-sm">加载失败</div></template>
              </el-image>
            </div>
          </div>
        </div>
        <el-empty v-else description="还没有任何体型照片" :image-size="56" />
      </SectionCard>
    </template>
    <el-skeleton v-else :rows="8" animated class="mt-16" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate, n, shift, signed } from '@/utils/format'
import { axisStyle, gridStyle, tooltipStyle } from '@/utils/chart'
import type { BodyPhoto, BodyResponse } from '@/types/api'
import StatCard from '@/components/StatCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import Chart from '@/components/Chart.vue'

const store = useAppStore()
const days = ref(90)
const data = ref<BodyResponse>()
const saving = ref(false)
const form = reactive({
  date: localDate(),
  weight_kg: store.profile?.weight_kg ?? 62,
  waist_cm: undefined as number | undefined,
  body_fat_pct: undefined as number | undefined,
  muscle_kg: undefined as number | undefined,
  note: '',
})

const hideWeight = computed(() => store.hideWeight)
const currentWeight = computed(() => data.value?.series.at(-1)?.value ?? 0)
const weightDelta = computed(() => {
  const s = data.value?.series ?? []
  return s.length ? Math.round((s[s.length - 1].value - s[0].value) * 10) / 10 : 0
})
const paceHint = computed(() => {
  const w = data.value?.weeklyChange ?? 0
  if (w <= -1.2) return '掉秤偏快，注意保住肌肉'
  if (w < -0.2) return '健康减脂区间 -0.2 ~ -1.0'
  if (w < 0.2) return '基本持平'
  return '体重在上升'
})
const bmiHint = computed(() => {
  const b = data.value?.stats.bmi ?? 0
  if (b < 18.5) return '偏瘦'
  if (b < 24) return '正常范围'
  if (b < 28) return '超重'
  return '肥胖'
})
const bmiTone = computed(() => {
  const b = data.value?.stats.bmi ?? 22
  return (b >= 24 ? 'warn' : 'good') as 'warn' | 'good'
})

const weightOption = computed(() => {
  const series = data.value?.series ?? []
  const trend = data.value?.trendSeries ?? []
  const range = data.value?.healthyRange
  const goal = data.value
  const label = series.map((p) => p.date.slice(5))
  return {
    grid: gridStyle({ top: 30, bottom: 4 }),
    tooltip: {
      ...tooltipStyle(),
      formatter: (p: any[]) =>
        `${p[0].axisValue}<br/>` + p.map((x) => `${x.marker}${x.seriesName} <b>${x.data ?? '—'}</b> kg`).join('<br/>'),
    },
    legend: { right: 0, top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#6c7787', fontSize: 11 } },
    xAxis: { type: 'category', data: label, ...axisStyle(), splitLine: { show: false }, boundaryGap: false },
    yAxis: { type: 'value', scale: true, ...axisStyle() },
    series: [
      {
        name: '实测体重',
        type: 'line',
        data: series.map((p) => p.value),
        symbolSize: 5,
        lineStyle: { width: 1.2, color: '#c9d4dd' },
        itemStyle: { color: '#a9b6c2' },
        connectNulls: true,
      },
      {
        name: '趋势',
        type: 'line',
        data: label.map((d) => trend.find((t) => t.date.slice(5) === d)?.value ?? null),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.6, color: '#12a37a' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(18,163,122,0.16)' },
              { offset: 1, color: 'rgba(18,163,122,0)' },
            ],
          },
        },
        markArea: range
          ? {
              silent: true,
              itemStyle: { color: 'rgba(18,163,122,0.05)' },
              label: { show: false },
              data: [[{ yAxis: range.min }, { yAxis: range.max }]],
            }
          : undefined,
        markLine: range
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: 'rgba(18,163,122,0.5)', type: 'dashed', width: 1 },
              label: { formatter: '健康上限', color: '#12a37a', fontSize: 10, position: 'insideEndTop' },
              data: [{ yAxis: range.max }],
            }
          : undefined,
      },
    ],
  }
})

async function load() {
  data.value = await api.body(days.value, localDate())
  if (data.value) {
    const last = data.value.series.at(-1)
    if (last) form.weight_kg = last.value
    const rec = data.value.records.at(-1)
    if (rec) {
      form.waist_cm = rec.waist_cm ?? undefined
      form.body_fat_pct = rec.body_fat_pct ?? undefined
      form.muscle_kg = rec.muscle_kg ?? undefined
      form.date = shift(rec.date, 0)
    }
  }
}

function openForm() {
  form.date = localDate()
}

async function save() {
  saving.value = true
  try {
    await api.saveBody({
      date: form.date,
      weight_kg: form.weight_kg,
      waist_cm: form.waist_cm,
      body_fat_pct: form.body_fat_pct,
      muscle_kg: form.muscle_kg,
      note: form.note,
    })
    ElMessage.success('已保存')
    await load()
    await store.refresh()
  } finally {
    saving.value = false
  }
}

async function remove(id: number) {
  try {
    await ElMessageBox.confirm('确定删除这条记录吗？', '删除', { type: 'warning' })
  } catch {
    return
  }
  await api.deleteBody(id)
  ElMessage.success('已删除')
  await load()
  await store.refresh()
}

/* 体型照片 */
const VIEW_LABEL: Record<BodyPhoto['view'], string> = { front: '正面', side: '侧面', back: '背面' }
const photoDate = ref(localDate())
const photos = ref<BodyPhoto[]>([])
const uploading = reactive({ front: false, side: false, back: false })
const compareView = ref<BodyPhoto['view']>('front')

async function loadPhotos() {
  photos.value = await api.bodyPhotos()
}

function photoFor(view: BodyPhoto['view']) {
  return photos.value.find((p) => p.date === photoDate.value && p.view === view)
}
const dateGroups = computed(() => {
  const map = new Map<string, BodyPhoto[]>()
  for (const p of photos.value) {
    if (!map.has(p.date)) map.set(p.date, [])
    map.get(p.date)!.push(p)
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
})
const comparePhotos = computed(() =>
  photos.value.filter((p) => p.view === compareView.value).sort((a, b) => a.date.localeCompare(b.date)),
)

async function doUpload(view: BodyPhoto['view'], opt: any) {
  uploading[view] = true
  try {
    await api.uploadBodyPhoto(opt.file as File, view, photoDate.value)
    ElMessage.success(`已上传${VIEW_LABEL[view]}照片`)
    await loadPhotos()
  } catch {
    /* 拦截器已提示错误 */
  } finally {
    uploading[view] = false
  }
}

async function removePhoto(id: number) {
  try {
    await ElMessageBox.confirm('确定删除这张照片吗？', '删除', { type: 'warning' })
  } catch {
    return
  }
  await api.deleteBodyPhoto(id)
  ElMessage.success('已删除')
  await loadPhotos()
}

onMounted(async () => {
  await load()
  await loadPhotos()
})
</script>

<style scoped>
.daybar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}
.body-main {
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  align-items: start;
}
@media (max-width: 1100px) {
  .body-main {
    grid-template-columns: minmax(0, 1fr);
  }
}
.forecast {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.forecast-num {
  font-size: 17px;
  color: var(--brand-dark);
}
.mb-12 {
  margin-bottom: 12px;
}
.photo-slots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 720px) {
  .photo-slots {
    grid-template-columns: 1fr;
  }
}
.photo-slot {
  border: 1px dashed var(--line);
  border-radius: 12px;
  padding: 10px;
}
.photo-slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.photo-slot-title {
  font-weight: 600;
  font-size: 13px;
}
.photo-slot-body {
  position: relative;
}
.photo-thumb {
  width: 100%;
  height: 168px;
  border-radius: 8px;
  display: block;
  background: #f3f5f7;
}
.photo-empty {
  height: 168px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa6b2;
  font-size: 12px;
  background: #f3f5f7;
  border-radius: 8px;
}
.photo-del {
  position: absolute;
  right: 6px;
  bottom: 6px;
}
.compare-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.compare-item {
  flex: 0 0 auto;
  width: 140px;
}
.compare-thumb {
  width: 140px;
  height: 180px;
  border-radius: 8px;
  display: block;
  background: #f3f5f7;
}
.compare-date {
  text-align: center;
  font-size: 12px;
  color: #9aa6b2;
  margin-top: 4px;
}
.date-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}
.date-group-title {
  font-size: 12px;
  color: #9aa6b2;
  margin-bottom: 4px;
}
.date-group-imgs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.date-thumb {
  width: 92px;
  height: 116px;
  border-radius: 8px;
  display: block;
  background: #f3f5f7;
}
.photo-empty-sm {
  width: 92px;
  height: 116px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #9aa6b2;
  background: #f3f5f7;
  border-radius: 8px;
}
</style>
