<template>
  <div class="goal rise">
    <div class="grid grid-3">
      <SectionCard title="当前目标" class="span-1">
        <div v-if="active" class="current">
          <el-progress type="dashboard" :percentage="progress" :width="132" :stroke-width="9" color="#12a37a">
            <template #default="{ percentage }">
              <div class="ring-num num">{{ Math.round(percentage) }}%</div>
              <div class="tiny muted">已完成</div>
            </template>
          </el-progress>
          <div class="facts">
            <div class="row-between"><span class="tiny muted">起始体重</span><b class="num">{{ active.start_weight }} kg</b></div>
            <div class="row-between"><span class="tiny muted">目标体重</span><b class="num">{{ active.target_weight }} kg</b></div>
            <div class="row-between"><span class="tiny muted">当前体重</span><b class="num">{{ currentWeight }} kg</b></div>
            <div class="row-between"><span class="tiny muted">还需减</span><b class="num tone-good">{{ remaining }} kg</b></div>
            <div class="row-between"><span class="tiny muted">目标日期</span><b class="num">{{ active.target_date }}</b></div>
            <div class="row-between"><span class="tiny muted">剩余天数</span><b class="num">{{ daysLeft }} 天</b></div>
          </div>
        </div>
        <EmptyState v-else icon="🎯" title="还没有进行中的目标" description="在右侧设置一个现实可达的目标" />
      </SectionCard>

      <SectionCard title="系统建议" sub="基于身高、体重与体脂给出">
        <div v-if="suggestion" class="suggest">
          <div class="sug-main">
            <span class="tiny muted">建议目标体重</span>
            <div class="big-num num">{{ suggestion.recommendedWeight }}<span class="unit">kg</span></div>
            <span class="pill pill-good">健康区间 {{ suggestion.healthyRange.min }}–{{ suggestion.healthyRange.max }} kg</span>
          </div>
          <div class="divider" />
          <div class="facts">
            <div class="row-between"><span class="tiny muted">当前 BMI</span><b class="num">{{ suggestion.bmi }}（{{ suggestion.bmiCategory.label }}）</b></div>
            <div class="row-between"><span class="tiny muted">建议周期</span><b class="num">约 {{ weeksNeeded }} 周（0.5 kg/周）</b></div>
            <div class="row-between"><span class="tiny muted">建议日期</span><b class="num">{{ suggestion.suggestedDate }}</b></div>
            <div class="row-between"><span class="tiny muted">需要每日缺口</span><b class="num">{{ suggestion.dailyDeficit.recommended }} kcal</b></div>
          </div>
          <el-alert
            class="mt-12"
            type="info"
            :closable="false"
            show-icon
            title="系统不会建议低于健康区间下限的体重，也不建议每周减超过 1 kg"
          />
        </div>
      </SectionCard>

      <SectionCard :title="active ? '调整 / 新建目标' : '设置目标'">
        <el-form label-position="top">
          <el-form-item label="目标体重">
            <div class="slider-row">
              <el-slider v-model="form.target_weight" :min="minWeight" :max="maxWeight" :step="0.1" :show-tooltip="false" style="flex: 1" />
              <el-input-number v-model="form.target_weight" :min="minWeight" :max="maxWeight" :step="0.1" :precision="1" style="width: 108px" />
            </div>
          </el-form-item>
          <el-form-item label="目标日期">
            <el-date-picker v-model="form.target_date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="每周目标减重">
            <el-radio-group v-model="form.weekly_target">
              <el-radio-button :value="0.25">0.25 kg</el-radio-button>
              <el-radio-button :value="0.5">0.5 kg</el-radio-button>
              <el-radio-button :value="0.75">0.75 kg</el-radio-button>
              <el-radio-button :value="1">1 kg</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.note" placeholder="例如：先减到 58，再看体脂" />
          </el-form-item>
        </el-form>

        <div class="calc">
          <div class="row-between">
            <span class="tiny muted">按目标日期计算的每日缺口</span>
            <b class="num" :class="requiredDeficit > maxDeficit ? 'tone-danger' : 'tone-good'">{{ requiredDeficit }} kcal</b>
          </div>
          <div class="row-between">
            <span class="tiny muted">系统允许的缺口上限</span>
            <b class="num">{{ maxDeficit }} kcal</b>
          </div>
          <div class="row-between">
            <span class="tiny muted">预计完成日期</span>
            <b class="num">{{ predictedDate }}</b>
          </div>
          <el-alert
            v-if="requiredDeficit > maxDeficit"
            class="mt-8"
            type="warning"
            :closable="false"
            show-icon
            title="按这个日期需要过大缺口，建议把日期往后延或把目标体重调高 1–2 kg"
          />
        </div>

        <el-button type="primary" class="w-full mt-12" :loading="saving" @click="save">
          {{ active ? '保存为目标' : '开始这个目标' }}
        </el-button>
      </SectionCard>
    </div>

    <SectionCard title="目标历史" class="mt-16">
      <el-table :data="goals" size="small">
        <el-table-column prop="start_date" label="开始" width="110" />
        <el-table-column label="起始 → 目标" width="150">
          <template #default="{ row }">{{ row.start_weight }} → {{ row.target_weight }} kg</template>
        </el-table-column>
        <el-table-column prop="target_date" label="目标日期" width="120" />
        <el-table-column label="每周目标" width="100">
          <template #default="{ row }">{{ row.weekly_target }} kg</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="pill" :class="row.status === 'active' ? 'pill-good' : 'pill-plain'">
              {{ row.status === 'active' ? '进行中' : '已归档' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="160" />
        <el-table-column label="操作" width="120" align="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'active'" link type="primary" size="small" @click="activate(row)">设为当前</el-button>
            <el-button link type="danger" size="small" @click="remove(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate, shift } from '@/utils/format'
import type { EnergyAnalysis } from '@/types/api'
import SectionCard from '@/components/SectionCard.vue'
import EmptyState from '@/components/EmptyState.vue'

const store = useAppStore()
const goals = ref<any[]>([])
const suggestion = ref<any>()
const energy = ref<EnergyAnalysis>()
const saving = ref(false)

const currentWeight = computed(() => store.profile?.weight_kg ?? 60)
const active = computed(() => goals.value.find((g) => g.status === 'active') ?? null)
const minWeight = computed(() => Math.round((suggestion.value?.healthyRange.min ?? 45) * 10) / 10)
const maxWeight = computed(() => Math.round(currentWeight.value * 10) / 10)

const form = reactive({
  target_weight: 58,
  target_date: shift(localDate(), 90),
  weekly_target: 0.5,
  note: '',
})

const remaining = computed(() => (active.value ? Math.round((currentWeight.value - active.value.target_weight) * 10) / 10 : 0))
const progress = computed(() => {
  if (!active.value) return 0
  const total = active.value.start_weight - active.value.target_weight
  return Math.max(0, Math.min(100, Math.round(((active.value.start_weight - currentWeight.value) / Math.max(0.1, total)) * 100)))
})
const daysLeft = computed(() =>
  active.value ? Math.max(0, Math.round((new Date(active.value.target_date).getTime() - new Date(localDate()).getTime()) / 86400000)) : 0,
)
const weeksNeeded = computed(() => {
  if (!suggestion.value) return 0
  return Math.max(1, Math.ceil((currentWeight.value - suggestion.value.recommendedWeight) / 0.5))
})

const tdee = computed(() => energy.value?.breakdown.tdee ?? 1800)
const maxDeficit = computed(() => Math.min(750, Math.round(tdee.value * 0.25)))
const requiredDeficit = computed(() => {
  const days = Math.max(1, Math.round((new Date(form.target_date).getTime() - new Date(localDate()).getTime()) / 86400000))
  return Math.round(((currentWeight.value - form.target_weight) * 7700) / days)
})
const predictedDate = computed(() => {
  const deficit = Math.min(requiredDeficit.value, maxDeficit.value)
  const days = Math.ceil(((currentWeight.value - form.target_weight) * 7700) / Math.max(1, deficit))
  return shift(localDate(), days)
})

async function load() {
  const [g, s, e] = await Promise.all([api.goals(), api.goalSuggestion(), api.energy(localDate())])
  goals.value = g
  suggestion.value = s
  energy.value = e
  if (active.value) {
    form.target_weight = active.value.target_weight
    form.target_date = active.value.target_date
    form.weekly_target = active.value.weekly_target
    form.note = active.value.note
  } else if (s) {
    form.target_weight = s.recommendedWeight
    form.target_date = s.suggestedDate
  }
}

async function save() {
  if (form.target_weight >= currentWeight.value) {
    ElMessage.warning('目标体重需要小于当前体重')
    return
  }
  saving.value = true
  try {
    await api.createGoal({ ...form, target_date: form.target_date })
    ElMessage.success('目标已保存')
    await load()
    await store.refresh()
  } finally {
    saving.value = false
  }
}

async function activate(row: any) {
  await api.updateGoal(row.id, { status: 'active' })
  ElMessage.success('已设为当前目标')
  await load()
}

async function remove(id: number) {
  try {
    await ElMessageBox.confirm('删除后不可恢复，确定吗？', '删除目标', { type: 'warning' })
  } catch {
    return
  }
  await api.deleteGoal(id)
  ElMessage.success('已删除')
  await load()
}

onMounted(load)
</script>

<style scoped>
.span-1 {
  min-width: 0;
}
.current {
  display: flex;
  align-items: center;
  gap: 20px;
}
.ring-num {
  font-size: 22px;
  font-weight: 700;
}
.facts {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.facts b {
  font-size: 13px;
}
.suggest {
  display: flex;
  flex-direction: column;
}
.sug-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.unit {
  font-size: 12px;
  color: var(--ink-400);
  margin-left: 3px;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}
.calc {
  background: #fbfcfc;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
@media (max-width: 1180px) {
  .grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
