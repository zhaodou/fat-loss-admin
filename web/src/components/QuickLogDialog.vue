<template>
  <el-dialog v-model="open" title="快速记录" width="520" :close-on-click-modal="false" class="quicklog-dialog" @open="onOpen">
    <el-tabs v-model="tab">
      <el-tab-pane label="体重" name="body">
        <el-form label-width="76px" label-position="left">
          <el-form-item label="日期">
            <el-date-picker v-model="body.date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="体重">
            <el-input-number v-model="body.weight_kg" :min="30" :max="200" :step="0.1" :precision="1" style="width: 160px" />
            <span class="muted tiny" style="margin-left: 8px">kg</span>
          </el-form-item>
          <el-form-item label="腰围">
            <el-input-number v-model="body.waist_cm" :min="40" :max="160" :step="0.1" :precision="1" style="width: 160px" />
            <span class="muted tiny" style="margin-left: 8px">cm（选填）</span>
          </el-form-item>
          <el-form-item label="体脂率">
            <el-input-number v-model="body.body_fat_pct" :min="3" :max="60" :step="0.1" :precision="1" style="width: 160px" />
            <span class="muted tiny" style="margin-left: 8px">%（选填）</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="饮食" name="diet">
        <el-form label-width="76px" label-position="left">
          <el-form-item label="餐次">
            <el-radio-group v-model="diet.meal_type">
              <el-radio-button v-for="m in mealOptions" :key="m.value" :value="m.value">{{ m.label }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="食物名称">
            <el-input v-model="diet.food_name" placeholder="例如：鸡胸肉、米饭、西红柿" style="width: 100%" />
          </el-form-item>
          <el-form-item label="份量">
            <el-input-number v-model="diet.amount_g" :min="1" :max="2000" :step="10" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">g</span>
          </el-form-item>
          <el-form-item label="热量">
            <el-input-number v-model="diet.kcal" :min="0" :max="3000" :step="10" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">kcal（手动填，或留 0 用每日饮食页自动算）</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="运动" name="workout">
        <el-form label-width="76px" label-position="left">
          <el-form-item label="运动">
            <el-select v-model="workout.exercise_id" filterable placeholder="选择运动类型" style="width: 100%" @change="onExerciseChange">
              <el-option v-for="e in exerciseOptions" :key="e.id" :label="`${e.icon} ${e.name}`" :value="e.id">
                <div class="row-between">
                  <span>{{ e.icon }} {{ e.name }}</span>
                  <span class="muted tiny num">MET {{ e.met }}</span>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('duration')" label="时长">
            <el-input-number v-model="workout.duration_min" :min="1" :max="300" :step="5" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">分钟</span>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('intensity')" label="强度">
            <el-radio-group v-model="workout.intensity">
              <el-radio-button value="low">低</el-radio-button>
              <el-radio-button value="moderate">中</el-radio-button>
              <el-radio-button value="high">高</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('start')" label="开始时间">
            <el-time-picker v-model="workout.start_time" format="HH:mm" value-format="HH:mm" placeholder="19:30" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">晚间运动不早于 18:00</span>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('distance')" label="距离">
            <el-input-number v-model="workout.distance_km" :min="0" :max="200" :step="0.5" :precision="2" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">km</span>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('hr')" label="平均心率">
            <el-input-number v-model="workout.avg_hr" :min="40" :max="220" :step="1" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">bpm</span>
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('sets')" label="组数">
            <el-input-number v-model="workout.sets" :min="0" :max="50" :step="1" style="width: 140px" />
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('reps')" label="次数/组">
            <el-input-number v-model="workout.reps" :min="0" :max="200" :step="1" style="width: 140px" />
          </el-form-item>
          <el-form-item v-if="visibleFields.includes('weight')" label="负重">
            <el-input-number v-model="workout.weight_kg" :min="0" :max="300" :step="0.5" :precision="1" style="width: 140px" />
            <span class="muted tiny" style="margin-left: 8px">kg</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate } from '@/utils/format'
import type { Exercise } from '@/types/api'

const model = defineModel<boolean>({ default: false })
const open = computed({
  get: () => model.value,
  set: (v: boolean) => (model.value = v),
})

const store = useAppStore()
const tab = ref('body')
const saving = ref(false)

const body = reactive({ date: localDate(), weight_kg: 60, waist_cm: undefined as number | undefined, body_fat_pct: undefined as number | undefined })
const diet = reactive({ meal_type: 'lunch', food_name: '', amount_g: 100, kcal: 0 })

const mealOptions = [
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '加餐', value: 'snack' },
]

const exerciseOptions = ref<Exercise[]>([])

// 与「记录运动」弹窗一致：不同运动类型显示不同字段
const CATEGORY_FIELDS: Record<string, string[]> = {
  有氧: ['duration', 'intensity', 'start', 'distance', 'hr'],
  力量: ['duration', 'intensity', 'start', 'sets', 'reps', 'weight', 'hr'],
  柔韧: ['duration', 'intensity', 'start'],
  球类: ['duration', 'intensity', 'start', 'distance', 'hr'],
  户外: ['duration', 'intensity', 'start', 'distance', 'hr'],
  日常: ['duration', 'intensity', 'start'],
}
const DEFAULT_FIELDS = ['duration', 'intensity', 'start', 'distance', 'hr']

const workout = reactive({
  exercise_id: undefined as number | undefined,
  category: '',
  name: '运动',
  met: 5,
  duration_min: 30,
  intensity: 'moderate' as 'low' | 'moderate' | 'high',
  start_time: '19:30',
  distance_km: 0,
  avg_hr: 0,
  sets: 0,
  reps: 0,
  weight_kg: 0,
})

const visibleFields = computed(() => CATEGORY_FIELDS[workout.category] ?? DEFAULT_FIELDS)

function onExerciseChange(id: number) {
  const ex = exerciseOptions.value.find((e) => e.id === id)
  if (ex) {
    workout.name = ex.name
    workout.met = ex.met
    workout.intensity = ex.intensity
    workout.category = ex.category
    if (ex.category !== '力量') {
      workout.sets = 0
      workout.reps = 0
      workout.weight_kg = 0
    }
  }
}

async function onOpen() {
  if (store.profile) body.weight_kg = store.profile.weight_kg
  if (!exerciseOptions.value.length) exerciseOptions.value = await api.exercises({})
}

async function submit() {
  saving.value = true
  try {
    if (tab.value === 'body') {
      await api.saveBody({ ...body })
      ElMessage.success('体重已记录')
    } else if (tab.value === 'diet') {
      await api.addDietEntries({
        date: localDate(),
        meal_type: diet.meal_type,
        food_name: diet.food_name || '自定义食物',
        amount_g: diet.amount_g,
        kcal: diet.kcal,
        source: 'manual',
      })
      ElMessage.success('饮食已记录')
    } else {
      await api.addWorkout({
        date: localDate(),
        exercise_id: workout.exercise_id,
        name: workout.name,
        met: workout.met,
        duration_min: workout.duration_min,
        intensity: workout.intensity,
        start_time: workout.start_time,
        distance_km: workout.distance_km || null,
        avg_hr: workout.avg_hr || null,
        sets: workout.sets || null,
        reps: workout.reps || null,
        weight_kg: workout.weight_kg || null,
      })
      ElMessage.success('运动已记录')
    }
    open.value = false
    await store.refresh()
  } finally {
    saving.value = false
  }
}
</script>

<style>
/* 弹窗整体限高：内容超出时仅 body 区滚动，底部提交按钮始终可见。
   完整覆盖 margin（去掉 EP 默认底部 50px），6vh + 84vh < 100vh，
   保证弹窗永远完整容纳在视口内，外层遮罩不会滚动、顶部不会被切。 */
.quicklog-dialog.el-dialog {
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  margin: 6vh auto;
}
.quicklog-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
