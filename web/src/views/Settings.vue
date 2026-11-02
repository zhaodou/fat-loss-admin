<template>
  <div class="settings rise">
    <div class="grid grid-2">
      <SectionCard title="个人资料" sub="基础代谢、BMI、健康体重区间都基于这些信息">
        <el-form label-width="96px" label-position="left">
          <el-form-item label="称呼">
            <el-input v-model="profile.nickname" style="width: 180px" />
          </el-form-item>
          <el-form-item label="性别">
            <el-radio-group v-model="profile.gender">
              <el-radio-button value="female">女</el-radio-button>
              <el-radio-button value="male">男</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="出生日期">
            <el-date-picker v-model="profile.birth_date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 180px" />
          </el-form-item>
          <el-form-item label="身高 cm">
            <el-input-number v-model="profile.height_cm" :min="120" :max="220" :step="1" style="width: 140px" />
          </el-form-item>
          <el-form-item label="当前体重 kg">
            <el-input-number v-model="profile.weight_kg" :min="30" :max="200" :step="0.1" :precision="1" style="width: 140px" />
            <span class="tiny muted" style="margin-left: 8px">仅作兜底，日常以体重记录为准</span>
          </el-form-item>
          <el-form-item label="体脂率 %">
            <el-input-number v-model="profile.body_fat_pct" :min="3" :max="60" :step="0.1" :precision="1" style="width: 140px" />
            <span class="tiny muted" style="margin-left: 8px">填写后基础代谢优先用 Katch-McArdle</span>
          </el-form-item>
          <el-form-item label="生活状态">
            <el-input v-model="profile.activity_note" placeholder="办公室坐班，通勤地铁" />
          </el-form-item>
        </el-form>
        <div class="row-between">
          <span class="tiny muted">BMI {{ profilePreview.bmi }} · 健康区间 {{ profilePreview.range }}</span>
          <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存资料</el-button>
        </div>
      </SectionCard>

      <div class="col gap-16">
        <SectionCard title="热量计算规则" sub="改这里会重算所有历史数据的缺口">
          <el-form label-width="112px" label-position="left">
            <el-form-item label="日常活动系数">
              <el-radio-group v-model="energy.activityLevel" class="col-group">
                <el-radio v-for="(v, k) in ACTIVITY_OPTIONS" :key="k" :value="k" class="activity-radio">
                  <span class="ar-label">{{ v.label }}</span>
                  <span class="ar-factor">×{{ v.factor }}</span>
                </el-radio>
              </el-radio-group>
            </el-form-item>
            <el-alert type="info" :closable="false" show-icon class="mb-12">
              该系数<b>不含刻意运动</b>。运动消耗按 MET 单独计算，并把运动时段从日常消耗中按分钟剔除，
              所以同一小时不会被算两次。这也是为什么这里的 1.3 比网上常见的 1.55 低。
            </el-alert>

            <el-form-item label="基础代谢公式">
              <el-select v-model="energy.bmrFormula" style="width: 200px">
                <el-option label="自动（有体脂用 Katch）" value="auto" />
                <el-option label="Mifflin-St Jeor" value="mifflin" />
                <el-option label="Katch-McArdle" value="katch" />
              </el-select>
            </el-form-item>

            <el-form-item label="运动时段去重">
              <el-switch v-model="energy.deductExerciseBaseline" />
              <span class="tiny muted" style="margin-left: 10px">
                {{ energy.deductExerciseBaseline ? '已开启：运动时长从日常消耗中扣除' : '已关闭：会重复计算运动时段的静息消耗' }}
              </span>
            </el-form-item>

            <el-form-item label="缺口上限">
              <el-slider v-model="energy.maxDeficitRatio" :min="0.1" :max="0.35" :step="0.01" :format-tooltip="(v: number) => `TDEE 的 ${Math.round(v * 100)}%`" style="flex: 1" />
              <span class="tiny num" style="margin-left: 10px">{{ Math.round(energy.maxDeficitRatio * 100) }}%</span>
            </el-form-item>
            <el-form-item label="缺口绝对上限">
              <el-input-number v-model="energy.maxDeficitKcal" :min="300" :max="1200" :step="50" style="width: 150px" />
              <span class="tiny muted" style="margin-left: 8px">kcal / 天</span>
            </el-form-item>
            <el-form-item label="摄入下限">
              <el-input-number v-model="energy.minIntakeFemale" :min="900" :max="1800" :step="50" style="width: 140px" />
              <span class="tiny muted" style="margin: 0 8px">女 /</span>
              <el-input-number v-model="energy.minIntakeMale" :min="1100" :max="2200" :step="50" style="width: 140px" />
              <span class="tiny muted" style="margin-left: 8px">男</span>
            </el-form-item>
            <el-form-item label="蛋白质目标">
              <el-input-number v-model="energy.proteinPerKg" :min="1" :max="2.5" :step="0.1" :precision="1" style="width: 140px" />
              <span class="tiny muted" style="margin-left: 8px">g / kg 体重</span>
            </el-form-item>
          </el-form>
          <el-button type="primary" :loading="savingSettings" @click="saveEnergy">保存计算规则</el-button>
        </SectionCard>
      </div>
    </div>

    <div class="grid grid-3 mt-16">
      <SectionCard title="单位与显示">
        <el-form label-width="72px" label-position="left">
          <el-form-item label="体重">
            <el-radio-group v-model="units.weight" size="small">
              <el-radio-button value="kg">kg</el-radio-button>
              <el-radio-button value="jin">斤</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="长度">
            <el-radio-group v-model="units.length" size="small">
              <el-radio-button value="cm">cm</el-radio-button>
              <el-radio-button value="inch">inch</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="能量">
            <el-radio-group v-model="units.energy" size="small">
              <el-radio-button value="kcal">kcal</el-radio-button>
              <el-radio-button value="kj">kJ</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-form>
        <el-button size="small" :loading="savingSettings" @click="saveUnits">保存单位</el-button>
      </SectionCard>

      <SectionCard title="隐私">
        <div class="switch-row">
          <div>
            <div class="sw-title">隐藏体重数字</div>
            <div class="tiny muted">看板与体重页显示为 •••</div>
          </div>
          <el-switch v-model="privacy.hideWeight" @change="savePrivacy" />
        </div>
        <div class="switch-row">
          <div>
            <div class="sw-title">模糊餐食照片</div>
            <div class="tiny muted">截图分享时更安全</div>
          </div>
          <el-switch v-model="privacy.maskPhotos" @change="savePrivacy" />
        </div>
        <div class="switch-row">
          <div>
            <div class="sw-title">仅本机存储</div>
            <div class="tiny muted">数据保存在本地 SQLite，不上传任何服务器</div>
          </div>
          <el-switch v-model="privacy.localOnly" disabled />
        </div>
      </SectionCard>

      <SectionCard title="数据管理" sub="导入导出为 JSON，可迁移到其他设备">
        <div class="data-actions">
          <el-button :icon="Download" plain @click="exportData">导出全部数据</el-button>
          <el-button :icon="Upload" plain @click="pickFile">导入数据</el-button>
          <el-select v-model="importMode" size="small" style="width: 110px">
            <el-option label="覆盖" value="replace" />
            <el-option label="合并" value="merge" />
          </el-select>
        </div>
        <input ref="fileInput" type="file" accept="application/json" hidden @change="importData" />
        <div class="divider" />
        <div class="danger-zone">
          <div>
            <div class="sw-title">清空业务数据</div>
            <div class="tiny muted">删除饮食、运动、体重、目标与分析记录，保留食物运动库</div>
          </div>
          <el-button type="danger" plain size="small" :loading="resetting" @click="resetData">清空</el-button>
        </div>
      </SectionCard>
    </div>

    <SectionCard title="关于" class="mt-16">
      <div class="about">
        <div>
          <div class="about-title">FitPilot · 个人 AI 减脂管理后台</div>
          <div class="tiny muted mt-4">
            Vue 3 + TypeScript + Vite + Element Plus + ECharts / Express + SQLite。
            所有热量计算集中在一个引擎里，前端只做展示；AI 建议为本地规则引擎，依据近 14–28 天数据生成。
          </div>
        </div>
        <div class="about-meta">
          <span class="pill pill-plain">v1.0.0</span>
          <span class="pill pill-plain">数据本地存储</span>
          <span class="pill pill-plain">无需联网</span>
        </div>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Upload } from '@element-plus/icons-vue'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate } from '@/utils/format'
import type { Profile, Settings } from '@/types/api'
import SectionCard from '@/components/SectionCard.vue'

const ACTIVITY_OPTIONS = {
  sedentary: { label: '久坐办公（几乎不走动）', factor: 1.2 },
  light: { label: '轻度活动（通勤 + 日常走动）', factor: 1.3 },
  moderate: { label: '中度活动（走动较多的岗位）', factor: 1.4 },
  active: { label: '高强度活动（体力工作）', factor: 1.5 },
} as const

const store = useAppStore()
const savingProfile = ref(false)
const savingSettings = ref(false)
const resetting = ref(false)
const fileInput = ref<HTMLInputElement>()
const importMode = ref('replace')

const profile = reactive({
  nickname: '我',
  gender: 'female' as 'male' | 'female',
  birth_date: '1995-01-01',
  height_cm: 165,
  weight_kg: 60,
  body_fat_pct: undefined as number | undefined,
  activity_note: '',
})

const energy = reactive({
  activityLevel: 'light' as keyof typeof ACTIVITY_OPTIONS,
  bmrFormula: 'auto',
  deductExerciseBaseline: true,
  maxDeficitRatio: 0.25,
  maxDeficitKcal: 750,
  minIntakeFemale: 1200,
  minIntakeMale: 1500,
  proteinPerKg: 1.6,
})

const units = reactive({ weight: 'kg', length: 'cm', energy: 'kcal' })
const privacy = reactive({ hideWeight: false, maskPhotos: false, localOnly: true })

const profilePreview = computed(() => {
  const h = profile.height_cm / 100
  const bmi = Math.round((profile.weight_kg / (h * h)) * 10) / 10
  const min = Math.round(18.5 * h * h * 10) / 10
  const max = Math.round(23.9 * h * h * 10) / 10
  return { bmi, range: `${min}–${max} kg` }
})

async function load() {
  const [p, s] = await Promise.all([api.profile(), api.settings()])
  Object.assign(profile, {
    nickname: p.nickname,
    gender: p.gender,
    birth_date: p.birth_date,
    height_cm: p.height_cm,
    weight_kg: p.weight_kg,
    body_fat_pct: p.body_fat_pct ?? undefined,
    activity_note: p.activity_note,
  })
  Object.assign(energy, s.energy)
  Object.assign(units, s.units)
  Object.assign(privacy, s.privacy)
}

async function saveProfile() {
  savingProfile.value = true
  try {
    await api.updateProfile({ ...profile } as Partial<Profile>)
    ElMessage.success('资料已保存')
    await store.refresh()
  } finally {
    savingProfile.value = false
  }
}

async function persist(patch: Partial<Settings>) {
  savingSettings.value = true
  try {
    await api.updateSettings(patch)
    await store.refresh()
    ElMessage.success('已保存，历史数据的计算结果已同步更新')
  } finally {
    savingSettings.value = false
  }
}

const saveEnergy = () => persist({ energy: { ...energy } as any })
const saveUnits = () => persist({ units: { ...units } })
const savePrivacy = () => persist({ privacy: { ...privacy } })

async function exportData() {
  const data = await api.exportData()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fatloss-export-${localDate()}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出')
}

function pickFile() {
  fileInput.value?.click()
}

async function importData(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    await ElMessageBox.confirm(
      `导入模式：${importMode.value === 'replace' ? '覆盖（会清空现有记录）' : '合并（保留现有记录）'}，确定继续？`,
      '导入数据',
      { type: 'warning' },
    )
    await api.importData({ mode: importMode.value, data: parsed.data ?? parsed })
    ElMessage.success('导入完成，刷新查看')
    await load()
    await store.refresh()
  } catch (err) {
    if (err instanceof SyntaxError) ElMessage.error('文件不是合法的 JSON')
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function resetData() {
  try {
    await ElMessageBox.confirm(
      '将删除饮食、运动、体重、目标与 AI 分析记录，食物库和运动库会保留。此操作不可撤销。',
      '清空业务数据',
      { type: 'warning', confirmButtonText: '确认清空' },
    )
  } catch {
    return
  }
  resetting.value = true
  try {
    await api.resetData(true)
    ElMessage.success('已清空')
    await store.refresh()
  } finally {
    resetting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.col-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.activity-radio {
  height: auto;
  margin-right: 0;
}
.activity-radio :deep(.el-radio__label) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ar-label {
  font-size: 12.5px;
}
.ar-factor {
  font-size: 11px;
  color: var(--brand-dark);
  background: var(--brand-soft);
  padding: 1px 6px;
  border-radius: 20px;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
}
.switch-row:last-child {
  border-bottom: none;
}
.sw-title {
  font-size: 12.5px;
  font-weight: 550;
}
.data-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.about {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.about-title {
  font-size: 13.5px;
  font-weight: 650;
}
.about-meta {
  display: flex;
  gap: 6px;
}
</style>
