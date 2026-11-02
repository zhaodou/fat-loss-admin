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
              <el-button :icon="Edit" circle size="small" :disabled="!meal.items.length" title="整体编辑这餐" @click="openEditMeal(meal)" />
              <el-button :icon="Plus" circle size="small" type="primary" @click="openCalc(meal.type)" />
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
            <EmptyState v-else icon="🍽️" title="还没有记录" description="点右上角 + 号，用一句话描述你吃了什么" />

            <div v-if="meal.photos.length" class="photos">
              <el-image
                v-for="p in meal.photos"
                :key="p.id"
                :src="p.url"
                :preview-src-list="[p.url]"
                fit="cover"
                class="photo"
                :class="{ masked: store.settings?.privacy.maskPhotos }"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 描述 → 计算 → 记录 / 整餐编辑 -->
    <el-dialog v-model="calcOpen" :title="editingMeal ? `整体编辑${MEAL_META[calcMeal].label}` : `记录${MEAL_META[calcMeal].label}`" width="760" :close-on-click-modal="false">
      <div class="calc">
        <div class="calc-input">
          <div class="row-between mb-6">
            <span class="tiny">用一句话描述这餐吃了什么</span>
            <el-radio-group v-model="calcMeal" size="small">
              <el-radio-button v-for="m in MEALS" :key="m.type" :value="m.type">{{ m.label }}</el-radio-button>
            </el-radio-group>
          </div>
          <el-input
            v-model="desc"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            resize="none"
            placeholder="例如：300g西红柿,100g大米饭，100g的鸡腿"
          />
          <div class="example-row">
            <span class="tiny muted">示例：</span>
            <button v-for="ex in examples" :key="ex" class="ex-chip" @click="desc = ex">{{ ex }}</button>
          </div>
          <el-button type="primary" class="w-full mt-8" :loading="estimating" :disabled="!desc.trim()" @click="onCalculate">
            计算营养
          </el-button>
          <div class="tiny muted mt-6 source-note">
            营养数据来自 Open Food Facts 开源食物库（常见食材取本地权威值），均为估算
          </div>
        </div>

        <div v-if="estimate" class="calc-result">
          <div class="result-head">共匹配 {{ estimate.matchedCount }} 项 · 本餐建议约 {{ estimate.mealKcalTarget }} kcal</div>

          <div class="totals">
            <div class="total-card" v-for="t in totalCards" :key="t.label">
              <div class="total-val num">{{ t.value }}<i>{{ t.unit }}</i></div>
              <div class="total-label">{{ t.label }}</div>
            </div>
          </div>

          <el-table :data="resolvedItems" size="small" class="result-table">
            <el-table-column prop="name" label="食物" min-width="100" />
            <el-table-column label="份量(g)" width="92" align="right">
              <template #default="{ row }">
                <el-input-number v-if="row.source === 'manual' || row.source === 'ai'" v-model="row.grams" :min="1" :max="2000" :step="10" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                <span v-else class="num">{{ row.grams }}</span>
              </template>
            </el-table-column>
            <el-table-column label="热量" width="86" align="right">
              <template #default="{ row }">
                <el-input-number v-if="row.source === 'manual' || row.source === 'ai'" v-model="row.kcal" :min="0" :max="2000" :step="1" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                <span v-else class="num">{{ row.kcal }}</span>
              </template>
            </el-table-column>
            <el-table-column label="蛋白" width="86" align="right">
              <template #default="{ row }">
                <el-input-number v-if="row.source === 'manual' || row.source === 'ai'" v-model="row.protein" :min="0" :max="500" :step="0.5" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                <span v-else class="num">{{ row.protein }}</span>
              </template>
            </el-table-column>
            <el-table-column label="脂肪" width="86" align="right">
              <template #default="{ row }">
                <el-input-number v-if="row.source === 'manual' || row.source === 'ai'" v-model="row.fat" :min="0" :max="500" :step="0.5" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                <span v-else class="num">{{ row.fat }}</span>
              </template>
            </el-table-column>
            <el-table-column label="碳水" width="86" align="right">
              <template #default="{ row }">
                <el-input-number v-if="row.source === 'manual' || row.source === 'ai'" v-model="row.carb" :min="0" :max="500" :step="0.5" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                <span v-else class="num">{{ row.carb }}</span>
              </template>
            </el-table-column>
            <el-table-column label="纤维" width="86" align="right">
              <template #default="{ row }">
                <el-input-number v-if="row.source === 'manual' || row.source === 'ai'" v-model="row.fiber" :min="0" :max="200" :step="0.1" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                <span v-else class="num">{{ row.fiber }}</span>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="92">
              <template #default="{ row }">
                <el-tag v-if="row.source === 'openfoodfacts'" size="small" type="success" effect="plain">开源接口</el-tag>
                <el-tag v-else-if="row.source === 'local'" size="small" type="info" effect="plain">本地库</el-tag>
                <el-tag v-else-if="row.source === 'ai'" size="small" effect="plain">AI 分析</el-tag>
                <el-tag v-else-if="row.source === 'manual'" size="small" type="warning" effect="plain">手动</el-tag>
                <el-tag v-else size="small" type="danger" effect="plain">未匹配</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="60" align="center">
              <template #default="{ row }">
                <el-button :icon="Delete" link size="small" type="danger" title="删除这一项" @click="removeCalcItem(estimate.items.indexOf(row))" />
              </template>
            </el-table-column>
          </el-table>

          <!-- 未匹配 → 手动补充 -->
          <div v-if="unmatchedItems.length" class="manual-supp">
            <div class="manual-head">
              <span class="tiny">有 <b>{{ unmatchedItems.length }}</b> 项没匹配到，手动补充营养后实时重算</span>
              <el-button size="small" type="primary" plain :disabled="!hasManualKcal" @click="adoptAll">全部采用</el-button>
            </div>
            <div v-for="(it, idx) in unmatchedItems" :key="'u' + idx" class="manual-row">
              <div class="manual-row-top">
                <span class="manual-name">{{ it.name }}</span>
                <span class="manual-grams">
                  <el-input-number v-model="it.grams" :min="1" :max="2000" :step="10" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" />
                  <span class="tiny muted">g</span>
                </span>
                <el-button size="small" type="success" plain :disabled="it.kcal <= 0" @click="adopt(it)">采用</el-button>
              </div>
              <div class="manual-grid">
                <div class="mg-cell"><span>热量</span><el-input-number v-model="it.kcal" :min="0" :max="2000" :step="1" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" /></div>
                <div class="mg-cell"><span>蛋白</span><el-input-number v-model="it.protein" :min="0" :max="500" :step="0.5" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" /></div>
                <div class="mg-cell"><span>脂肪</span><el-input-number v-model="it.fat" :min="0" :max="500" :step="0.5" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" /></div>
                <div class="mg-cell"><span>碳水</span><el-input-number v-model="it.carb" :min="0" :max="500" :step="0.5" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" /></div>
                <div class="mg-cell"><span>纤维</span><el-input-number v-model="it.fiber" :min="0" :max="200" :step="0.1" size="small" controls-position="right" class="cell-num" @change="recalcDebounced" /></div>
              </div>
            </div>
          </div>

          <div class="advice">
            <div class="advice-title"><el-icon><InfoFilled /></el-icon> 饮食建议</div>
            <ul class="advice-list">
              <li v-for="(a, i) in estimate.advice" :key="i">{{ a }}</li>
            </ul>
          </div>

          <el-button
            type="primary"
            class="w-full mt-8"
            :loading="saving"
            :disabled="!estimate.matchedCount"
            @click="onConfirm"
          >
            {{ editingMeal ? `保存整餐替换（${estimate.matchedCount} 项）` : `确认记录这餐（${estimate.matchedCount} 项）` }}
          </el-button>
          <div v-if="!estimate.matchedCount" class="tiny muted mt-6">没有可记录的食物，换个更通用的说法再试，例如「鸡腿」「米饭」「西红柿」。</div>
        </div>
      </div>
    </el-dialog>

    <!-- 编辑 -->
    <el-dialog v-model="editOpen" title="修改记录" width="420">
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
      </el-form>
      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, CopyDocument, Delete, Edit, InfoFilled, Plus } from '@element-plus/icons-vue'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { localDate, MEAL_META, n, relativeDay, shift, weekday } from '@/utils/format'
import type { DietDay, DietEntry, MealType, NutritionEstimate, NutritionEstimateItem } from '@/types/api'

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

const examples = ['300g西红柿,100g大米饭，100g的鸡腿', '2个鸡蛋 + 1片全麦面包 + 一杯牛奶', '150g鸡胸肉，200g米饭，100g西兰花']

/* 计算弹窗 */
const calcOpen = ref(false)
const calcMeal = ref<MealType>('lunch')
/** 编辑模式：非 null 表示正在整体编辑该餐次（确认时整餐替换，而非追加） */
const editingMeal = ref<MealType | null>(null)
const desc = ref('')
const estimating = ref(false)
const saving = ref(false)
const estimate = ref<NutritionEstimate | null>(null)

const totalCards = computed(() => {
  const t = estimate.value?.totals
  if (!t) return []
  return [
    { label: '总热量', value: t.kcal, unit: 'kcal' },
    { label: '蛋白质', value: t.protein, unit: 'g' },
    { label: '脂肪', value: t.fat, unit: 'g' },
    { label: '碳水', value: t.carb, unit: 'g' },
    { label: '膳食纤维', value: t.fiber, unit: 'g' },
  ]
})

function openCalc(meal: MealType) {
  calcMeal.value = meal
  editingMeal.value = null
  calcOpen.value = true
  estimate.value = null
  desc.value = ''
}

/** 整体编辑某餐：预填该餐的原始描述，自动重算，确认后整餐替换 */
function openEditMeal(meal: { type: MealType; raw_text: string; items: DietEntry[] }) {
  calcMeal.value = meal.type
  editingMeal.value = meal.type
  calcOpen.value = true
  estimate.value = null
  desc.value = meal.raw_text || meal.items.map((i) => `${i.amount_g}g${i.food_name}`).join(',')
  if (desc.value.trim()) onCalculate()
}

async function onCalculate() {
  if (!desc.value.trim()) return
  estimating.value = true
  try {
    estimate.value = await api.estimateDiet({ text: desc.value, mealType: calcMeal.value })
  } finally {
    estimating.value = false
  }
}

/* 未匹配食物的「手动补充 → 重新计算」 */
const resolvedItems = computed(() => estimate.value?.items.filter((i) => i.matched) ?? [])
const unmatchedItems = computed(() => estimate.value?.items.filter((i) => i.source === 'none') ?? [])
const hasManualKcal = computed(() => unmatchedItems.value.some((i) => i.kcal > 0))

let recalcTimer: ReturnType<typeof setTimeout> | null = null
function recalcDebounced() {
  if (recalcTimer) clearTimeout(recalcTimer)
  recalcTimer = setTimeout(() => recalc(), 400)
}

/** 重新计算：只回写 totals/advice/matchedCount，保留 items 数组本体，避免输入框失焦 */
async function recalc() {
  if (!estimate.value) return
  try {
    const res = await api.recalculateEstimate({ items: estimate.value.items, mealType: calcMeal.value })
    estimate.value.totals = res.totals
    estimate.value.advice = res.advice
    estimate.value.mealKcalTarget = res.mealKcalTarget
    estimate.value.matchedCount = res.matchedCount
  } catch {
    /* 错误提示已由拦截器处理 */
  }
}

/** 采用一条手填食物：标为已匹配 + 来源 manual，并触发重算 */
function adopt(it: NutritionEstimateItem) {
  it.matched = true
  it.source = 'manual'
  recalc()
}

/** 一键采用所有已填热量的未匹配食物 */
function adoptAll() {
  unmatchedItems.value.forEach((it) => {
    if (it.kcal > 0) {
      it.matched = true
      it.source = 'manual'
    }
  })
  recalc()
}

async function onConfirm() {
  if (!estimate.value) return
  const matched = estimate.value.items.filter((i) => i.matched)
  if (!matched.length) return
  saving.value = true
  try {
    const targetMeal = editingMeal.value ?? calcMeal.value
    const payload = {
      date: date.value,
      meal_type: targetMeal,
      raw_text: desc.value,
      items: matched.map((it) => ({
        meal_type: targetMeal,
        food_name: it.name,
        amount_g: it.grams,
        kcal: it.kcal,
        protein: it.protein,
        carb: it.carb,
        fat: it.fat,
        fiber: it.fiber,
        source: it.source,
      })),
    }
    if (editingMeal.value) {
      await api.replaceDietMeal(payload)
      ElMessage.success(`已整体替换${MEAL_META[editingMeal.value].label}`)
    } else {
      await api.addDietEntries(payload)
      ElMessage.success(`已记录 ${matched.length} 项到${MEAL_META[calcMeal.value].label}`)
    }
    calcOpen.value = false
    editingMeal.value = null
    await load()
    store.touch()
  } finally {
    saving.value = false
  }
}

/* 编辑 / 删除 */
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

async function saveEdit() {
  if (!editing.value) return
  await api.updateDietEntry(editing.value.id, { amount_g: editAmount.value, meal_type: editMeal.value })
  editOpen.value = false
  ElMessage.success('已更新')
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

/** 整体编辑弹窗里移除某一项：只从本次编辑列表删除，保存时整餐替换即生效，其余食物不影响 */
function removeCalcItem(index: number) {
  if (!estimate.value || index < 0) return
  estimate.value.items.splice(index, 1)
  recalc()
}

/* 汇总 */
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

/* 日期 */
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
}
.photo {
  width: 58px;
  height: 58px;
  border-radius: 10px;
}
.photo.masked {
  filter: blur(8px);
}

/* 计算弹窗 */
.calc {
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
.example-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.ex-chip {
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink-700);
  cursor: pointer;
}
.ex-chip:hover {
  border-color: var(--brand);
  color: var(--brand-dark);
  background: var(--brand-soft);
}
.source-note {
  text-align: center;
}
.calc-result {
  border-top: 1px dashed var(--line);
  padding-top: 14px;
}
.result-head {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 10px;
}
.totals {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.total-card {
  background: var(--brand-soft);
  border: 1px solid #cfeee2;
  border-radius: 10px;
  padding: 10px 6px;
  text-align: center;
}
.total-val {
  font-size: 18px;
  font-weight: 700;
  color: var(--brand-dark);
}
.total-val i {
  font-style: normal;
  font-size: 10px;
  color: var(--ink-400);
  font-weight: 400;
  margin-left: 2px;
}
.total-label {
  font-size: 11px;
  color: var(--ink-500);
  margin-top: 2px;
}
.result-table {
  margin-bottom: 12px;
}
.advice {
  background: #f7faf9;
  border: 1px solid var(--line);
  border-left: 3px solid var(--brand);
  border-radius: 10px;
  padding: 10px 12px;
}
.advice-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--brand-dark);
  margin-bottom: 6px;
}
.advice-list {
  margin: 0;
  padding-left: 18px;
}
.advice-list li {
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--ink-700);
}

/* 手动补充未匹配食物 */
.manual-supp {
  margin: 4px 0 12px;
  border: 1px dashed #f0c69c;
  background: #fffaf2;
  border-radius: 10px;
  padding: 10px 12px;
}
.manual-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--ink-700);
}
.manual-head b {
  color: #e08a2b;
}
.manual-row {
  border-top: 1px dashed #f3d6b4;
  padding: 8px 0;
}
.manual-row:first-of-type {
  border-top: none;
}
.manual-row-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.manual-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-900);
}
.manual-grams {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.manual-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.mg-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mg-cell > span {
  font-size: 11px;
  color: var(--ink-500);
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
</style>
