<template>
  <div class="diet rise">
    <!-- 日期栏 -->
    <div class="daybar card">
      <div class="row gap-8">
        <el-button :icon="ArrowLeft" circle size="small" @click="go(-1)" />
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 148px" @change="onDateChange" />
        <el-button :icon="ArrowRight" circle size="small" @click="go(1)" />
        <span class="pill pill-plain">{{ relativeDay(date) }} · {{ weekday(date) }}</span>
      </div>
      <div class="row gap-8">
        <el-button :icon="CopyDocument" plain @click="copyYesterday">复制昨天</el-button>
        <el-dropdown trigger="click" @command="clearDay">
          <el-button :icon="Delete" plain>清空</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="all">清空当天全部</el-dropdown-item>
              <el-dropdown-item v-for="m in MEALS" :key="m.type" :command="m.type">只清空{{ m.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <template v-if="day">
      <!-- 汇总 -->
      <div class="grid grid-3 mt-16">
        <SectionCard title="今日摄入">
          <div class="intake-head">
            <div>
              <div class="big-num num">{{ n(day.totals.kcal) }}<span class="unit">kcal</span></div>
              <div class="tiny muted mt-4">目标 {{ n(day.target.intake) }} kcal · 缺口目标 {{ n(day.target.plannedDeficit) }}</div>
            </div>
            <el-progress
              type="dashboard"
              :percentage="Math.min(100, Math.round((day.totals.kcal / Math.max(1, day.target.intake)) * 100))"
              :width="88"
              :stroke-width="7"
              :color="intakeColor"
            >
              <template #default="{ percentage }">
                <div class="ring-num num">{{ Math.round(percentage) }}%</div>
              </template>
            </el-progress>
          </div>
          <div class="intake-foot">
            <span :class="day.remaining >= 0 ? 'tone-good' : 'tone-danger'">
              {{ day.remaining >= 0 ? `还可摄入 ${n(day.remaining)} kcal` : `已超出 ${n(-day.remaining)} kcal` }}
            </span>
          </div>
        </SectionCard>

        <SectionCard title="三大营养素" sub="蛋白质优先，脂肪别低于 0.6 g/kg">
          <div class="macro-row" v-for="m in macroBars" :key="m.key">
            <div class="row-between">
              <span class="tiny">{{ m.label }}</span>
              <span class="tiny num"><b>{{ m.value }}</b> / {{ m.target }} g</span>
            </div>
            <div class="macro-bar">
              <div class="macro-fill" :style="{ width: Math.min(100, (m.value / Math.max(1, m.target)) * 100) + '%', background: m.color }" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="热量分布" sub="按餐次">
          <div class="dist">
            <div v-for="m in day.meals" :key="m.type" class="dist-row">
              <span class="dist-dot" :style="{ background: MEAL_META[m.type].color }" />
              <span class="dist-name">{{ m.label }}</span>
              <div class="dist-bar">
                <div :style="{ width: pctOf(m.subtotal.kcal) + '%', background: MEAL_META[m.type].color }" />
              </div>
              <span class="dist-val num">{{ m.subtotal.kcal }}</span>
            </div>
          </div>
          <div class="tiny muted mt-12">记录 {{ day.totals.count }} 条 · 膳食纤维 {{ day.totals.fiber }} g</div>
        </SectionCard>
      </div>

      <!-- 四餐 -->
      <div class="grid grid-2 mt-16">
        <div v-for="meal in day.meals" :key="meal.type" class="card meal-card">
          <div class="meal-head">
            <span class="meal-emoji">{{ MEAL_META[meal.type].icon }}</span>
            <div class="col">
              <span class="meal-title">{{ meal.label }}</span>
              <span class="tiny muted">{{ MEAL_META[meal.type].hint }}</span>
            </div>
            <div class="meal-head-right">
              <span class="num meal-total">{{ meal.subtotal.kcal }}<i> kcal</i></span>
              <el-button :icon="Plus" circle size="small" type="primary" title="AI 拍照 / 描述分析这一餐" @click="openAnalysis(meal.type)" />
            </div>
          </div>

          <div class="meal-body">
            <div v-if="meal.items.length" class="items">
              <div v-for="item in meal.items" :key="item.id" class="item">
                <div class="item-main">
                  <span class="item-name">{{ item.food_name }}</span>
                  <span class="item-amount num">{{ item.amount_g }} g</span>
                </div>
                <div class="item-nutri tiny muted num">
                  P {{ item.protein }} · C {{ item.carb }} · F {{ item.fat }}
                </div>
                <span class="item-kcal num">{{ item.kcal }}</span>
                <div class="item-actions">
                  <el-button :icon="Edit" link size="small" @click="openEdit(item)" />
                  <el-button :icon="Delete" link size="small" type="danger" @click="removeEntry(item)" />
                </div>
              </div>
              <div class="meal-subtotal">
                <span class="tiny muted">小计 蛋白 {{ meal.subtotal.protein }}g · 碳水 {{ meal.subtotal.carb }}g · 脂肪 {{ meal.subtotal.fat }}g</span>
              </div>
            </div>
            <EmptyState v-else icon="📸" title="还没有记录" description="点右上角 + 号，上传饮食照片或描述吃了什么，AI 帮你算热量" />

            <div v-if="meal.photos.length" class="photos">
              <div v-for="p in meal.photos" :key="p.id" class="photo-wrap">
                <el-image
                  :src="p.url"
                  :preview-src-list="meal.photos.map((x) => x.url)"
                  fit="cover"
                  class="photo"
                  :class="{ masked: store.settings?.privacy.maskPhotos }"
                />
                <el-button
                  class="photo-del"
                  :icon="Close"
                  circle
                  size="small"
                  type="danger"
                  title="删除这张照片"
                  @click="removePhoto(p)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- AI 饮食热量分析 -->
    <el-dialog v-model="anaOpen" :title="`AI 饮食热量分析 · ${MEAL_META[anaMeal].label}`" width="760" :close-on-click-modal="false" class="analysis-dialog">
      <div class="ana">
        <div class="ana-input">
          <div class="row-between mb-6">
            <span class="tiny">餐次</span>
            <el-radio-group v-model="anaMeal" size="small" :disabled="analyzing || saving">
              <el-radio-button v-for="m in MEALS" :key="m.type" :value="m.type">{{ m.label }}</el-radio-button>
            </el-radio-group>
          </div>

          <div class="tiny ana-label">饮食照片（可选，最多 5 张，支持 JPG / PNG / WEBP）</div>
          <el-upload
            v-model:file-list="uploadList"
            drag
            multiple
            list-type="picture-card"
            accept=".jpg,.jpeg,.png,.webp"
            :limit="5"
            :disabled="analyzing || saving"
            :before-upload="beforeUpload"
            :http-request="doUpload"
            :on-remove="onRemoveFile"
            :on-exceed="onExceed"
            :on-preview="onPreview"
            class="ana-upload"
          >
            <div class="upload-trigger">
              <el-icon class="upload-icon"><Plus /></el-icon>
              <div class="tiny">点击或拖拽上传</div>
              <div class="tiny muted">最多 5 张 · 单张 ≤ 10MB</div>
            </div>
          </el-upload>

          <div class="tiny ana-label mt-8">文字描述（可选）</div>
          <el-input
            v-model="anaDesc"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            resize="none"
            placeholder="请描述本次饮食，例如：一碗米饭、两个鸡腿、一份西兰花，也可以补充食物重量、烹饪方式等信息。"
            :disabled="analyzing || saving"
          />

          <el-button
            type="primary"
            class="w-full mt-8"
            :loading="analyzing"
            :disabled="!canAnalyze"
            @click="onAnalyze"
          >
            {{ analyzing ? 'AI 正在分析…' : '热量分析' }}
          </el-button>
          <div class="tiny muted mt-6 source-note">
            图片与描述至少填写一项；你描述的食物重量将优先于图片估算。分析由后端模型完成，图片与描述会一并发送给所配置的 AI。
          </div>
        </div>

        <!-- 分析结果 -->
        <div v-if="anaResult" class="ana-result">
          <div class="result-banner">
            <div>
              <div class="tiny muted">本次饮食总热量</div>
              <div class="big-num num">{{ resultTotal }}<span class="unit">kcal</span></div>
            </div>
            <div class="tiny muted engine-note">
              识别 {{ anaResult.foods.length }} 项食物 · {{ engineLabel }}
            </div>
          </div>

          <el-table :data="anaResult.foods" size="small" class="result-table">
            <el-table-column label="食物名称" min-width="120">
              <template #default="{ row }">
                <el-input v-model="row.name" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="估算重量" width="130" align="right">
              <template #default="{ row }">
                <div class="cell-weight">
                  <el-input-number v-model="row.weight" :min="1" :max="5000" :step="10" size="small" controls-position="right" class="cell-num" @change="onWeightChange(row)" />
                  <span class="tiny muted">g</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="热量" width="132" align="right">
              <template #default="{ row }">
                <div class="cell-weight">
                  <el-input-number v-model="row.calories" :min="0" :max="5000" :step="5" size="small" controls-position="right" class="cell-num" @change="onCaloriesChange(row)" />
                  <span class="tiny muted">kcal</span>
                </div>
                <div v-if="row.caloriesPer100g > 0" class="cell-basis">每100g约 {{ row.caloriesPer100g }} kcal，改重量按此重算</div>
              </template>
            </el-table-column>
            <el-table-column label="置信度" width="76" align="center">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.confidence >= 0.85 ? 'success' : row.confidence >= 0.6 ? 'warning' : 'danger'">
                  {{ Math.round(row.confidence * 100) }}%
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="130" prop="remark">
              <template #default="{ row }">
                <span class="tiny muted">{{ row.remark || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="56" align="center">
              <template #default="{ $index }">
                <el-button :icon="Delete" link size="small" type="danger" title="删除这一项" @click="removeFood($index)" />
              </template>
            </el-table-column>
          </el-table>

          <div v-if="anaResult.conflictWarnings?.length" class="conflict-box">
            <div class="conflict-title">⚠ 图片与描述存在冲突</div>
            <ul>
              <li v-for="(w, i) in anaResult.conflictWarnings" :key="'c' + i">{{ w }}</li>
            </ul>
          </div>

          <div class="ai-notes">
            <div class="notes-title">AI 分析说明</div>
            <p class="notes-body">{{ anaResult.analysisSummary }}</p>
            <template v-if="anaResult.uncertainties.length">
              <div class="notes-title">不确定因素</div>
              <ul class="notes-list">
                <li v-for="(u, i) in anaResult.uncertainties" :key="'u' + i">{{ u }}</li>
              </ul>
            </template>
          </div>

          <div class="row gap-8 mt-8">
            <el-button plain :loading="analyzing" :disabled="saving" @click="onAnalyze">重新分析</el-button>
            <el-button type="primary" class="flex-1" :loading="saving" :disabled="!anaResult.foods.length" @click="onSave">
              保存到{{ MEAL_META[anaMeal].label }}（{{ resultTotal }} kcal）
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 图片预览 -->
    <el-dialog v-model="previewOpen" title="图片预览" width="520">
      <img v-if="previewUrl" :src="previewUrl" class="preview-img" />
    </el-dialog>

    <!-- 编辑 -->
    <el-dialog v-model="editOpen" title="修改记录" width="460">
      <el-form label-width="70px" label-position="left">
        <el-form-item label="食物">{{ editing?.food_name }}</el-form-item>
        <el-form-item label="份量">
          <el-input-number v-model="editAmount" :min="1" :max="2000" :step="10" />
          <span class="tiny muted" style="margin-left: 8px">g</span>
        </el-form-item>
        <el-form-item label="餐次">
          <el-select v-model="editMeal" style="width: 160px">
            <el-option v-for="m in MEALS" :key="m.type" :label="m.label" :value="m.type" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="editPreview" label="重算后">
          <div class="edit-preview">
            <div>
              热量 <b>{{ editing?.kcal }}</b> → <b class="tone-good">{{ editPreview.kcal }}</b> kcal
            </div>
            <div class="tiny muted">
              蛋白 {{ editing?.protein }} → {{ editPreview.protein }}g · 碳水 {{ editing?.carb }} → {{ editPreview.carb }}g · 脂肪
              {{ editing?.fat }} → {{ editPreview.fat }}g
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile, UploadRawFile, UploadRequestOptions, UploadUserFile } from 'element-plus'
import { ArrowLeft, ArrowRight, Close, CopyDocument, Delete, Edit, Plus } from '@element-plus/icons-vue'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate, MEAL_META, n, relativeDay, shift, weekday } from '@/utils/format'
import type { DietDay, DietEntry, AnalysisFoodItem, MealAnalysisResult, MealType } from '@/types/api'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
/** 记住当前查看的日期：优先用 URL 上的 ?date=，否则取今天，避免刷新后跳回今天 */
const date = ref<string>((route.query.date as string) || localDate())
const day = ref<DietDay>()

const MEALS = [
  { type: 'breakfast' as MealType, label: '早餐' },
  { type: 'lunch' as MealType, label: '午餐' },
  { type: 'dinner' as MealType, label: '晚餐' },
  { type: 'snack' as MealType, label: '加餐' },
]

/* --------------------------- AI 饮食热量分析 --------------------------- */

const anaOpen = ref(false)
const anaMeal = ref<MealType>('lunch')
const anaDesc = ref('')
const uploadList = ref<UploadUserFile[]>([])
/** uid → 服务器图片地址（上传成功后记录，删除时同步移除） */
const urlMap = reactive(new Map<number, string>())
const analyzing = ref(false)
const saving = ref(false)
const anaResult = ref<MealAnalysisResult | null>(null)
const previewOpen = ref(false)
const previewUrl = ref('')

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp']

/** 已成功上传的图片地址 */
const uploadedUrls = computed(() =>
  uploadList.value
    .filter((f) => f.status === 'success' && f.uid !== undefined && urlMap.get(f.uid) !== undefined)
    .map((f) => urlMap.get(f.uid!)!),
)
/** 还有图片在上传中 */
const uploading = computed(() => uploadList.value.some((f) => f.status === 'uploading'))
/** 图片 / 描述至少一项 + 没有正在上传的图片 */
const canAnalyze = computed(() => !analyzing.value && !saving.value && !uploading.value && (anaDesc.value.trim().length > 0 || uploadedUrls.value.length > 0))

/** 总热量 = 各项之和（用户编辑名称/重量/热量后自动重算） */
const resultTotal = computed(() => Math.round((anaResult.value?.foods ?? []).reduce((a, f) => a + (Number(f.calories) || 0), 0)))

const engineLabel = computed(() => {
  const e = anaResult.value?.engine
  const m = anaResult.value?.model
  if (e === 'vision-model') return `视觉模型 ${m ?? ''}（图片 + 描述）`
  if (e === 'text-only') return '纯文字分析（照片未参与）'
  if (e === 'demo') return '演示模式（本地估算）'
  return m || ''
})

function openAnalysis(meal: MealType) {
  anaMeal.value = meal
  anaOpen.value = true
  anaDesc.value = ''
  uploadList.value = []
  urlMap.clear()
  anaResult.value = null
}

function beforeUpload(file: UploadRawFile): boolean {
  if (!ACCEPTED_MIME.includes(file.type)) {
    ElMessage.error('仅支持 JPG / PNG / WEBP 格式的图片')
    return false
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.error('单张图片不能超过 10MB')
    return false
  }
  return true
}

/** 自定义上传：逐张调用图片上传接口（与分析分离），成功后记录服务器地址 */
async function doUpload(options: UploadRequestOptions) {
  try {
    const res = await api.uploadAnalysisImages([options.file as File])
    const uploadFile = uploadList.value.find((f) => f.raw === options.file)
    if (uploadFile && uploadFile.uid !== undefined) urlMap.set(uploadFile.uid, res.urls[0] ?? '')
    options.onSuccess(res)
  } catch (err: any) {
    const msg = err?.message || '图片上传失败'
    options.onError(Object.assign(new Error(msg), { status: 0, method: 'POST', url: '' }) as any)
  }
}

function onRemoveFile(file: UploadFile) {
  urlMap.delete(file.uid)
}

function onExceed() {
  ElMessage.warning('最多上传 5 张图片')
}

function onPreview(file: UploadFile) {
  previewUrl.value = file.url || ''
  previewOpen.value = true
}

async function onAnalyze() {
  if (!canAnalyze.value) {
    if (uploading.value) ElMessage.warning('还有图片正在上传，请稍候')
    else ElMessage.warning('请至少上传一张饮食照片或填写文字描述')
    return
  }
  analyzing.value = true
  anaResult.value = null
  try {
    anaResult.value = await api.analyzeMeal({
      mealType: anaMeal.value,
      description: anaDesc.value.trim(),
      imageUrls: uploadedUrls.value,
    })
    if (anaResult.value.engine === 'text-only') {
      ElMessage.warning('照片未能参与分析，本次结果仅基于文字描述')
    }
  } catch {
    /* 错误提示已由拦截器处理，可修改后重新分析 */
  } finally {
    analyzing.value = false
  }
}

/** 删除识别错误的某一项（编辑重量/名称后总热量自动重算） */
function removeFood(index: number) {
  anaResult.value?.foods.splice(index, 1)
}

/** 修改重量后按「每100g热量 × 新重量」重新估算该项热量，总热量随之自动更新 */
function onWeightChange(row: AnalysisFoodItem) {
  if (row.caloriesPer100g > 0 && row.weight > 0) {
    row.calories = Math.round((row.caloriesPer100g * row.weight) / 100)
  }
}

/** 手动修改热量后，反推每100g热量（保留1位小数），保证后续改重量时估算基准一致 */
function onCaloriesChange(row: AnalysisFoodItem) {
  if (row.weight > 0) {
    row.caloriesPer100g = Math.round((row.calories / row.weight) * 1000) / 10
  }
}

async function onSave() {
  if (!anaResult.value?.foods.length) return
  saving.value = true
  try {
    await api.saveMealAnalysis({
      date: date.value,
      mealType: anaMeal.value,
      description: anaDesc.value.trim(),
      imageUrls: uploadedUrls.value,
      analysis: anaResult.value,
    })
    ElMessage.success(`已记录 ${anaResult.value.foods.length} 项到${MEAL_META[anaMeal.value].label}（${resultTotal.value} kcal）`)
    anaOpen.value = false
    await load()
    store.touch()
  } finally {
    saving.value = false
  }
}

/* ------------------------------ 编辑 / 删除 ------------------------------ */

const editOpen = ref(false)
const editing = ref<DietEntry | null>(null)
const editAmount = ref(100)
const editMeal = ref<MealType>('lunch')

function openEdit(item: DietEntry) {
  editing.value = item
  editAmount.value = item.amount_g
  editMeal.value = item.meal_type
  editOpen.value = true
}

/** 改动重量后的营养预览：热量/宏量按「新重量 ÷ 原重量」等比缩放（与后端一致） */
const editPreview = computed(() => {
  const item = editing.value
  if (!item || !item.amount_g || item.amount_g <= 0) return null
  const ratio = editAmount.value / item.amount_g
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  const scale1 = (v: number) => Math.round(v * ratio * 10) / 10
  const kcal = Math.round(item.kcal * ratio)
  if (kcal === item.kcal) return null
  return { kcal, protein: scale1(item.protein), carb: scale1(item.carb), fat: scale1(item.fat) }
})

async function saveEdit() {
  if (!editing.value) return
  const res = await api.updateDietEntry(editing.value.id, { amount_g: editAmount.value, meal_type: editMeal.value })
  editOpen.value = false
  ElMessage.success(res.entry ? `已更新：${res.entry.amount_g}g · ${res.entry.kcal} kcal（按新重量重算）` : '已更新')
  await load()
  store.touch()
}

/** 删除某餐中的一张饮食照片（同时删除服务器磁盘文件，不影响该餐已记录的食物） */
async function removePhoto(p: { id: number }) {
  try {
    await ElMessageBox.confirm(
      '确定删除这张饮食照片吗？\n（仅移除照片，该餐已记录的食物不受影响）',
      '删除照片',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await api.deletePhoto(p.id)
  ElMessage.success('已删除照片')
  await load()
  store.touch()
}

async function removeEntry(item: DietEntry) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${item.food_name} ${item.amount_g}g」这一条吗？\n删除后这一餐的其它食物不受影响。`,
      '删除食物',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await api.deleteDietEntry(item.id)
  ElMessage.success('已删除该食物')
  await load()
  store.touch()
}

/* --------------------------------- 汇总 --------------------------------- */

const proteinTarget = computed(() => Math.round((store.profile?.weight_kg ?? 60) * (store.settings?.energy.proteinPerKg ?? 1.6)))
const fatTarget = computed(() => Math.round(((day.value?.target.intake ?? 1500) * 0.28) / 9))
const carbTarget = computed(() => {
  const kcal = day.value?.target.intake ?? 1500
  return Math.round((kcal - proteinTarget.value * 4 - fatTarget.value * 9) / 4)
})

const macroBars = computed(() => [
  { key: 'p', label: '蛋白质', value: day.value?.totals.protein ?? 0, target: proteinTarget.value, color: '#12a37a' },
  { key: 'c', label: '碳水', value: day.value?.totals.carb ?? 0, target: carbTarget.value, color: '#3b82f6' },
  { key: 'f', label: '脂肪', value: day.value?.totals.fat ?? 0, target: fatTarget.value, color: '#f59e0b' },
])

const intakeColor = computed(() => {
  const p = (day.value?.totals.kcal ?? 0) / Math.max(1, day.value?.target.intake ?? 1)
  if (p > 1.08) return '#ef4444'
  if (p > 0.95) return '#f59e0b'
  return '#12a37a'
})

function pctOf(kcal: number): number {
  const total = day.value?.totals.kcal || 1
  return Math.round((kcal / total) * 100)
}

/* --------------------------------- 日期 --------------------------------- */

async function load() {
  day.value = await api.dietDay(date.value)
}

function go(delta: number) {
  date.value = shift(date.value, delta)
  router.replace({ query: { ...route.query, date: date.value } })
  load()
}

/** 日期选择器变化：同步到 URL（刷新/重载后保持），并重新拉取 */
function onDateChange() {
  router.replace({ query: { ...route.query, date: date.value } })
  load()
}

/** 响应 URL 上的日期变化（如点顶部「回到今天」会把 ?date= 设为今天） */
watch(
  () => route.query.date,
  (q) => {
    const d = (q as string) || localDate()
    if (d !== date.value) {
      date.value = d
      load()
    }
  },
)

async function copyYesterday() {
  const from = shift(date.value, -1)
  try {
    const res = await api.copyDay(from, date.value)
    ElMessage.success(`已复制 ${res.copied} 条记录`)
    await load()
    store.touch()
  } catch {
    /* 错误提示已由拦截器处理 */
  }
}

async function clearDay(cmd: string) {
  const label = cmd === 'all' ? '当天全部记录' : MEAL_META[cmd as MealType].label
  try {
    await ElMessageBox.confirm(`确定清空${label}吗？`, '清空记录', { type: 'warning' })
  } catch {
    return
  }
  await api.clearDay(date.value, cmd === 'all' ? undefined : cmd)
  ElMessage.success('已清空')
  await load()
  store.touch()
}

onMounted(async () => {
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
.intake-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.unit {
  font-size: 12px;
  color: var(--ink-400);
  margin-left: 4px;
  font-weight: 500;
}
.ring-num {
  font-size: 17px;
  font-weight: 700;
}
.intake-foot {
  margin-top: 10px;
  font-size: 12.5px;
  font-weight: 600;
}
.macro-row {
  margin-bottom: 12px;
}
.macro-bar {
  height: 6px;
  background: #f1f4f6;
  border-radius: 4px;
  margin-top: 6px;
  overflow: hidden;
}
.macro-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.35s ease;
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
}
.dist-dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.dist-name {
  width: 34px;
  color: var(--ink-700);
}
.dist-bar {
  flex: 1;
  height: 6px;
  background: #f1f4f6;
  border-radius: 4px;
  overflow: hidden;
}
.dist-bar > div {
  height: 100%;
  border-radius: 4px;
}
.dist-val {
  width: 42px;
  text-align: right;
  color: var(--ink-700);
}
.meal-card {
  padding: 0;
  overflow: hidden;
}
.meal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: #fcfdfd;
}
.meal-emoji {
  font-size: 19px;
}
.meal-title {
  font-size: 13.5px;
  font-weight: 650;
}
.meal-head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.meal-total {
  font-size: 15px;
  font-weight: 700;
  margin-right: 4px;
}
.meal-total i {
  font-style: normal;
  font-size: 10px;
  color: var(--ink-400);
  font-weight: 400;
}
.meal-body {
  padding: 6px 16px 14px;
  min-height: 92px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed #f1f4f6;
}
.item:last-of-type {
  border-bottom: none;
}
.item-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.item-name {
  font-size: 13px;
  color: var(--ink-900);
}
.item-amount {
  font-size: 11.5px;
  color: var(--ink-400);
}
.item-nutri {
  white-space: nowrap;
}
.item-kcal {
  font-size: 13px;
  font-weight: 600;
  width: 48px;
  text-align: right;
}
.item-actions {
  display: flex;
  opacity: 0;
  transition: opacity 0.15s;
}
.item:hover .item-actions {
  opacity: 1;
}
.meal-subtotal {
  padding-top: 8px;
  border-top: 1px solid var(--line);
  margin-top: 4px;
}
.photos {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.photo-wrap {
  position: relative;
}
.photo {
  width: 58px;
  height: 58px;
  border-radius: 10px;
  display: block;
}
.photo.masked {
  filter: blur(8px);
}
.photo-del {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 20px;
  height: 20px;
  padding: 0;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.15s, transform 0.15s;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.photo-del :deep(.el-icon) {
  font-size: 12px;
}
.photo-wrap:hover .photo-del {
  opacity: 1;
  transform: scale(1);
}

/* AI 分析弹窗 */
.ana {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mb-6 {
  margin-bottom: 6px;
}
.ana-label {
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
.ana-upload :deep(.el-upload-list--picture-card .el-upload-list__item) {
  width: 88px;
  height: 88px;
}
.ana-upload :deep(.el-upload--picture-card) {
  width: 88px;
  height: 88px;
  overflow: hidden;
}
/* drag 模式下 EP 会把 .el-upload-dragger 塞进卡片里，其默认 padding 40px 10px 且无高度限制，
   会从 88px 卡片中溢出压住下方表单，必须一并约束尺寸 */
.ana-upload :deep(.el-upload-dragger) {
  width: 88px;
  height: 88px;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
}
.upload-trigger {
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.upload-trigger .tiny {
  font-size: 11px;
  line-height: 1.4;
}
.upload-icon {
  font-size: 20px;
  color: var(--ink-400);
}
.source-note {
  text-align: center;
}
.ana-result {
  border-top: 1px dashed var(--line);
  padding-top: 14px;
}
.result-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--brand-soft);
  border: 1px solid #cfeee2;
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.engine-note {
  text-align: right;
}
.result-table {
  margin-bottom: 12px;
}
.cell-weight {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}
.cell-num {
  width: 100%;
}
.cell-num :deep(.el-input-number__decrease),
.cell-num :deep(.el-input-number__increase) {
  display: none;
}
.cell-num :deep(.el-input__inner) {
  text-align: right;
  padding-right: 8px;
}
.cell-basis {
  font-size: 11px;
  color: var(--ink-400);
  text-align: right;
  margin-top: 2px;
  line-height: 1.4;
}
.conflict-box {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.conflict-title {
  font-size: 12.5px;
  font-weight: 650;
  color: #c2410c;
  margin-bottom: 4px;
}
.conflict-box ul {
  margin: 0;
  padding-left: 18px;
}
.conflict-box li {
  font-size: 12.5px;
  line-height: 1.7;
  color: #9a3412;
}
.ai-notes {
  background: #f7faf9;
  border: 1px solid var(--line);
  border-left: 3px solid var(--brand);
  border-radius: 10px;
  padding: 10px 12px;
}
.notes-title {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--brand-dark);
  margin-bottom: 4px;
}
.notes-body {
  margin: 0 0 6px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-700);
}
.notes-list {
  margin: 0;
  padding-left: 18px;
}
.notes-list li {
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--ink-700);
}
.preview-img {
  width: 100%;
  border-radius: 10px;
}
.edit-preview {
  line-height: 1.6;
}
.edit-preview b {
  font-weight: 650;
}
</style>

<style>
/* 弹窗整体限高：内容超出时仅 body 区滚动，底部按钮始终可见（选择器须用全局样式，scoped 不生效） */
.analysis-dialog.el-dialog {
  margin: 6vh auto;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
}
.analysis-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
