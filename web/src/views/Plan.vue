<template>
  <div class="plan rise">
    <div class="grid plan-main">
      <SectionCard title="作息与工作安排" sub="运动只会安排在真实存在的空档里">
        <el-form label-position="top">
          <div class="grid grid-2" style="gap: 12px">
            <el-form-item label="上班时间">
              <el-time-picker v-model="form.work_start" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
            <el-form-item label="下班时间">
              <el-time-picker v-model="form.work_end" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
            <el-form-item label="午休开始">
              <el-time-picker v-model="form.lunch_start" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
            <el-form-item label="午休结束">
              <el-time-picker v-model="form.lunch_end" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
            <el-form-item label="午饭需要多久（分钟）">
              <el-input-number v-model="form.meal_minutes" :min="15" :max="90" :step="5" style="width: 100%" />
            </el-form-item>
            <el-form-item label="晚餐时间">
              <el-time-picker v-model="form.dinner_time" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
            <el-form-item label="起床时间">
              <el-time-picker v-model="form.wake_time" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
            <el-form-item label="睡觉时间">
              <el-time-picker v-model="form.sleep_time" format="HH:mm" value-format="HH:mm" style="width: 100%" />
            </el-form-item>
          </div>

          <el-form-item label="每周训练日">
            <el-checkbox-group v-model="form.workout_days">
              <el-checkbox-button v-for="d in weekdays" :key="d.value" :value="d.value">{{ d.label }}</el-checkbox-button>
            </el-checkbox-group>
          </el-form-item>

          <el-form-item label="偏好运动">
            <el-select v-model="form.preferred" multiple filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
              <el-option v-for="e in exercises" :key="e.id" :label="`${e.icon} ${e.name}`" :value="e.name" />
            </el-select>
          </el-form-item>

          <div class="grid grid-2" style="gap: 12px">
            <el-form-item label="饮食风格">
              <el-input v-model="dietStyle" placeholder="中式家常 / 外卖为主 / 食堂" />
            </el-form-item>
            <el-form-item label="每日步数目标">
              <el-input-number v-model="form.step_goal" :min="2000" :max="30000" :step="500" style="width: 100%" />
            </el-form-item>
          </div>

          <el-form-item label="需要避开的食物">
            <el-select v-model="dietAvoid" multiple filterable allow-create default-first-option placeholder="例如：油炸、奶茶" style="width: 100%" />
          </el-form-item>

          <el-form-item label="备注">
            <el-input v-model="form.note" type="textarea" :rows="2" placeholder="例如：周三晚上固定加班，不能安排运动" />
          </el-form-item>
        </el-form>

        <el-button type="primary" :loading="saving" @click="save">保存计划</el-button>
        <el-button @click="load">重置</el-button>
      </SectionCard>

      <div class="col gap-16">
        <SectionCard title="今日可用时段" sub="保存后按新作息实时计算">
          <div class="slots">
            <div v-for="s in schedule?.slots ?? []" :key="s.key" class="slot" :class="{ off: !s.feasible }">
              <div class="row-between">
                <span class="slot-label">{{ s.label }}</span>
                <span class="num tiny">{{ s.start }}–{{ s.end }}</span>
              </div>
              <div class="slot-act">{{ s.activity }}</div>
              <div class="tiny muted">
                {{ s.feasible ? `${s.durationMin} 分钟 · 约 ${s.kcal} kcal · MET ${s.met}` : s.reason }}
              </div>
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

        <SectionCard title="排期规则" sub="这些是硬约束，不会被绕过">
          <ul class="rules">
            <li>
              <b>午休必须先吃饭</b>
              <span>12:00–14:00 先扣除 {{ form.meal_minutes }} 分钟用餐，剩下的时间才安排低强度散步，不排中高强度（没条件洗澡）。</span>
            </li>
            <li>
              <b>晚间运动不早于 18:00</b>
              <span>下班后先练再吃，或者饭后 1 小时再练，二者取一个能塞进日程的方案。</span>
            </li>
            <li>
              <b>早上只排低强度</b>
              <span>起床后到出门要留够通勤和早餐时间，剩余不足 20 分钟就不安排。</span>
            </li>
            <li>
              <b>睡眠优先</b>
              <span>任何运动都不晚于睡前 1 小时结束，睡不够的减脂效率更低。</span>
            </li>
          </ul>
        </SectionCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate } from '@/utils/format'
import type { DaySchedule, Exercise } from '@/types/api'
import SectionCard from '@/components/SectionCard.vue'

const store = useAppStore()
const schedule = ref<DaySchedule>()
const exercises = ref<Exercise[]>([])
const saving = ref(false)
const dietStyle = ref('')
const dietAvoid = ref<string[]>([])

const weekdays = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
]

const form = reactive({
  work_start: '09:00',
  work_end: '18:00',
  lunch_start: '12:00',
  lunch_end: '14:00',
  meal_minutes: 40,
  dinner_time: '18:30',
  wake_time: '07:00',
  sleep_time: '23:30',
  workout_days: [1, 3, 5],
  preferred: [] as string[],
  step_goal: 8000,
  note: '',
})

async function load() {
  const [p, s, ex] = await Promise.all([api.plan(), api.schedule(localDate()), api.exercises({})])
  Object.assign(form, {
    work_start: p.work_start,
    work_end: p.work_end,
    lunch_start: p.lunch_start,
    lunch_end: p.lunch_end,
    meal_minutes: p.meal_minutes,
    dinner_time: p.dinner_time,
    wake_time: p.wake_time,
    sleep_time: p.sleep_time,
    workout_days: p.workout_days,
    preferred: p.preferred,
    step_goal: p.step_goal,
    note: p.note,
  })
  dietStyle.value = p.diet_pref?.style ?? '中式家常'
  dietAvoid.value = p.diet_pref?.avoid ?? []
  schedule.value = s
  exercises.value = ex
}

async function save() {
  saving.value = true
  try {
    await api.updatePlan({
      ...form,
      diet_pref: { style: dietStyle.value, avoid: dietAvoid.value, likes: [] },
    })
    await store.refresh()
    schedule.value = await api.schedule(localDate())
    ElMessage.success('计划已保存，运动时段已重新计算')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.plan-main {
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  align-items: start;
}
@media (max-width: 1100px) {
  .plan-main {
    grid-template-columns: minmax(0, 1fr);
  }
}
.slots {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slot {
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 11px 13px;
  background: #fbfdfc;
}
.slot.off {
  background: #fafafa;
  opacity: 0.75;
}
.slot-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--brand-dark);
}
.slot.off .slot-label {
  color: var(--ink-400);
}
.slot-act {
  font-size: 13px;
  font-weight: 550;
  margin: 4px 0 2px;
}
.rules {
  margin: 0;
  padding-left: 16px;
}
.rules li {
  margin-bottom: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-500);
}
.rules b {
  display: block;
  color: var(--ink-900);
  font-size: 12.5px;
  margin-bottom: 2px;
}
</style>
