export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type Intensity = 'low' | 'moderate' | 'high'

export interface Profile {
  id: number
  nickname: string
  gender: 'male' | 'female'
  birth_date: string
  height_cm: number
  weight_kg: number
  body_fat_pct: number | null
  activity_note: string
  bmi: number
  bmiCategory: { label: string; tone: string }
  healthyRange: { min: number; max: number; ideal: number }
}

export interface Plan {
  work_start: string
  work_end: string
  lunch_start: string
  lunch_end: string
  meal_minutes: number
  dinner_time: string
  wake_time: string
  sleep_time: string
  workout_days: number[]
  preferred: string[]
  diet_pref: { style: string; avoid: string[]; likes: string[] }
  step_goal: number
  note: string
}

export interface EnergySettings {
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active'
  bmrFormula: 'auto' | 'mifflin' | 'katch'
  deductExerciseBaseline: boolean
  intensityFactor: { low: number; moderate: number; high: number }
  maxDeficitRatio: number
  maxDeficitKcal: number
  minIntakeMale: number
  minIntakeFemale: number
  proteinPerKg: number
}

export interface Settings {
  units: { weight: string; length: string; energy: string }
  energy: EnergySettings
  privacy: { hideWeight: boolean; maskPhotos: boolean; localOnly: boolean }
  ai: {
    provider: string
    model: string
    endpoint: string
    apiKey: string
    temperature: number
    tone: string
  }
  demoSeeded: boolean
}

export interface ServingUnit {
  label: string
  grams: number
}

/* ------------------------------ 我的助手 ------------------------------ */

export interface LlmPreset {
  id: string
  name: string
  endpoint: string
  model: string
  models: string[]
  hint: string
  /** 零成本：完全免费或长期免费额度 */
  free?: boolean
  /** 不需要 API Key（演示模式 / 本地模型） */
  needKey?: boolean
  /** 选中后的注意事项 */
  note?: string
}

export interface AssistantConfig {
  provider: string
  providerName: string
  model: string
  endpoint: string
  temperature: number
  tone: string
  hasKey: boolean
  keyMasked: string
  source: 'env' | 'settings'
  ready: boolean
  missing: string[]
  /** 视觉模型（可选）：AI 饮食热量分析用，留空则用主模型尝试 */
  visionModel?: string
  presets: LlmPreset[]
}

export interface AssistantThread {
  id: number
  title: string
  created_at: string
  updated_at: string
  message_count: number
  preview: string
}

export interface AssistantMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  model: string
  tokens: number
  created_at: string
}

export interface Food {
  id: number
  name: string
  category: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  sodium: number
  unit: string
  serving_g: number
  serving_label: string
  pinyin: string
  is_builtin: number
  kind: 'ingredient' | 'dish'
  /** 自定义单位表，如 [{label:'片', grams:35}] */
  servings: ServingUnit[]
  /** 后端算好的完整单位表（含「克」），前端直接用 */
  units: ServingUnit[]
  note?: string
}

/** 餐食里的一个组成食材 */
export interface DishItem {
  food_id: number | null
  name: string
  grams: number
  units: number | null
  unit: string | null
}

export interface Dish extends Food {
  items: DishItem[]
  item_count: number
}

/** 组合计算的一行结果 */
export interface RecipeLine {
  food_id: number | null
  name: string
  grams: number
  units: number | null
  unit: string | null
  amount_label: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
}

export interface RecipePreview {
  lines: RecipeLine[]
  total: { grams: number; kcal: number; protein: number; carb: number; fat: number; fiber: number }
  per100: { kcal: number; protein: number; carb: number; fat: number; fiber: number }
  unresolved: { name: string; reason: string }[]
  units_hint: { food_id: number; servings: ServingUnit[] }[]
}

/** 照片识别结果：拆成食材，而不是直接给一个热量数字 */
export interface RecognizedItem {
  food_id: number | null
  name: string
  grams: number
  units: number | null
  unit: string | null
  amount_label: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  confidence: number
  checked?: boolean
}

export interface RecognitionResult {
  engine: 'heuristic' | 'vision-model'
  dish_name: string
  category: string
  items: RecognizedItem[]
  total: { grams: number; kcal: number; protein: number; carb: number; fat: number; fiber: number }
  candidates: { name: string; kcal: number; items: number }[]
  note: string
}

export interface Exercise {
  id: number
  name: string
  category: string
  met: number
  intensity: Intensity
  icon: string
  note: string
  is_builtin: number
}

export interface Workout {
  id: number
  date: string
  start_time: string
  exercise_id: number | null
  name: string
  duration_min: number
  intensity: Intensity
  met: number
  kcal: number
  distance_km: number | null
  avg_hr: number | null
  sets: number | null
  reps: number | null
  weight_kg: number | null
  route: string | null
  note: string
}

export interface DietEntry {
  id: number
  date: string
  meal_type: MealType
  food_id: number | null
  food_name: string
  amount_g: number
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  photo: string | null
  source: string
  food_kind?: 'ingredient' | 'dish'
  raw_text?: string | null
  created_at: string
}

export interface DietDay {
  date: string
  meals: {
    type: MealType
    label: string
    items: DietEntry[]
    subtotal: { kcal: number; protein: number; carb: number; fat: number }
    raw_text: string
    photos: { id: number; url: string; recognized: any }[]
  }[]
  totals: { kcal: number; protein: number; carb: number; fat: number; fiber: number; byMeal: Record<MealType, number>; count: number }
  target: { intake: number; tdee: number; plannedDeficit: number; floor: number }
  energy: EnergyBreakdown
  remaining: number
}

export interface EnergyBreakdown {
  date: string
  weightKg: number
  bmr: number
  bmrFormula: string
  activityFactor: number
  activityLevel: string
  exerciseMinutes: number
  exerciseKcal: number
  bmrPortion: number
  neatKcal: number
  tdee: number
  intakeKcal: number
  deficit: number
  deficitRatio: number
  plannedDeficit: number
  intakeFloor: number
  status: string
  notes: string[]
}

export interface Dashboard {
  date: string
  profile: { nickname: string; height: number; gender: string; age: number; bmi: number; bmiCategory: { label: string; tone: string } }
  weight: {
    current: number
    source: string
    from: string
    trend: number | null
    weeklyChange: number
    deltaFromTrend: number | null
    series: { date: string; value: number }[]
    range: { min: number; max: number; spread: number }
  }
  intake: { kcal: number; protein: number; carb: number; fat: number; fiber: number; byMeal: Record<MealType, number>; count: number; target: number; remaining: number; completion: number }
  burn: {
    bmr: number
    bmrFull: number
    neat: number
    exercise: number
    exerciseMinutes: number
    tdee: number
    activityLevel: string
    activityFactor: number
    exerciseList: Workout[]
  }
  deficit: { value: number; planned: number; completion: number; ratio: number; status: string; notes: string[]; floor: number; maxDeficit: number }
  goal: {
    startWeight: number
    targetWeight: number
    targetDate: string
    daysLeft: number
    remaining: number
    progress: number
    predictedDate: string
  } | null
  week: { avgIntake: number; avgDeficit: number; avgTdee: number; workoutDays: number; exerciseMin: number; loggedDays: number; weightChange: number | null }
  meals: { type: MealType; label: string; kcal: number; items: number }[]
  workouts: Workout[]
  plan: { workStart: string; workEnd: string; lunchStart: string; lunchEnd: string; dinnerTime: string; workoutDays: number[] }
  streak: number
  advice: { date: string; score: number; headline: string; level: string } | null
  units: Settings['units']
  privacy: Settings['privacy']
}

export interface Slot {
  key: 'morning' | 'lunch' | 'evening'
  label: string
  start: string
  end: string
  durationMin: number
  activity: string
  intensity: Intensity
  met: number
  kcal: number
  note: string
  feasible: boolean
  reason?: string
}

export interface DaySchedule {
  slots: Slot[]
  warnings: string[]
  mealWindow: { start: string; end: string; minutes: number }
  eveningEarliest: string
}

export interface Advice {
  id: string
  category: 'data' | 'diet' | 'exercise' | 'habit' | 'goal'
  level: 'good' | 'info' | 'warn' | 'danger'
  title: string
  summary: string
  evidence: string[]
  actions: string[]
  confidence: number
  adjustment?: string
}

export interface AdvicePayload {
  date: string
  generatedAt: string
  engine: string
  score: number
  level: string
  headline: string
  summary: string
  metrics: {
    date: string
    windowDays: number
    weightPoints: number
    loggedDietDays: number
    currentWeight: number
    trendWeight: number
    weeklyChange14: number
    weeklyChange28: number
    singleDayDelta: number
    avgIntake7: number
    avgIntake14: number
    avgTdee: number
    avgDeficit7: number
    avgDeficit14: number
    plannedDeficit: number
    targetIntake: number
    proteinAvg: number
    proteinTarget: number
    workouts7: number
    workoutMinutes7: number
    plannedWorkouts: number
    expectedWeeklyChange: number
    adherence: number | null
    macroRatio: { protein: number; carb: number; fat: number }
  }
  advices: Advice[]
  nextActions: string[]
  guardrails: string[]
  schedule: DaySchedule
  weekPlan: { date: string; weekday: number; isWorkoutDay: boolean; focus: string; slots: Slot[]; plannedKcal: number }[]
  goal: {
    targetWeight: number
    recommendedWeight: number
    healthyRange: { min: number; max: number; ideal: number }
    targetDate: string
    predictedDate: string
    daysLeft: number
    progress: number
    feasible: boolean
  } | null
}

export interface BodyResponse {
  start: string
  end: string
  records: {
    id: number
    date: string
    weight_kg: number | null
    waist_cm: number | null
    body_fat_pct: number | null
    muscle_kg: number | null
    note: string
  }[]
  series: { date: string; value: number }[]
  trendSeries: { date: string; value: number }[]
  trendWeight: number | null
  weeklyChange: number
  r2: number
  forecast30: number | null
  stats: { min: number; max: number; spread: number; average: number | null; count: number; bmi: number | null }
  healthyRange: { min: number; max: number; ideal: number }
}

/** 体型照片：正面(front) / 侧面(side) / 背面(back) */
export interface BodyPhoto {
  id: number
  date: string
  view: 'front' | 'side' | 'back'
  url: string
  note: string
  created_at: string
}

export interface EnergyAnalysis {
  date: string
  weight: { value: number; source: string; from: string }
  formula: { bmr: string; bmrName: string; activityName: string; activityFactor: number; metFormula: string }
  breakdown: {
    bmrFull: number
    bmrPortion: number
    neat: number
    exercise: number
    exerciseMinutes: number
    tdee: number
    intake: number
    deficit: number
    deficitRatio: number
  }
  exercises: { name: string; minutes: number; intensity: string; met: number; kcal: number; start: string }[]
  macros: {
    protein: number
    carb: number
    fat: number
    fiber: number
    kcal: number
    ratio: { protein: number; carb: number; fat: number }
    targetProtein: number
  }
  target: { intake: number; plannedDeficit: number; floor: number; maxDeficit: number; recommendedDeficit: number; requiredDeficit: number }
  notes: string[]
  plan: { required: number; recommended: number; daysLeft: number; predictedDate: string; feasible: boolean }
}

export interface Bucket {
  key: string
  label: string
  start: string
  end: string
  avgIntake: number
  avgTdee: number
  avgDeficit: number
  weightEnd: number | null
  weightChange: number | null
  exerciseMin: number
  workoutDays: number
  loggedDays: number
}

export interface StatsReport {
  granularity: 'week' | 'month' | 'year'
  start: string
  end: string
  anchor: string
  series: {
    date: string
    intake: number
    tdee: number
    bmr: number
    neat: number
    exerciseKcal: number
    exerciseMin: number
    deficit: number
    weight: number | null
    hasDiet: boolean
    mealCount: number
  }[]
  buckets: Bucket[]
  summary: {
    start: string
    end: string
    days: number
    loggedDays: number
    avgIntake: number
    avgTdee: number
    avgDeficit: number
    totalDeficit: number
    totalExerciseMin: number
    totalExerciseKcal: number
    workoutDays: number
    weightStart: number | null
    weightEnd: number | null
    weightChange: number | null
    protein: number
    carb: number
    fat: number
    macroRatio: { protein: number; carb: number; fat: number }
    goalCompletion: number
  }
  previous: StatsReport['summary']
  compare: { intake: number; deficit: number; exerciseMin: number; weightChange: number }
  goal: { targetWeight: number; targetDate: string; startWeight: number; progress: number } | null
}

export interface WorkoutSummary {
  start: string
  end: string
  total: { count: number; minutes: number; kcal: number; days: number }
  byCategory: { category: string; minutes: number; kcal: number; count: number }[]
  byWeek: { week: string; minutes: number; kcal: number; count: number }[]
}

/* ------------------------------ 每日饮食：描述→营养估算 ------------------------------ */

export type NutriSource = 'openfoodfacts' | 'local' | 'ai' | 'none' | 'manual'

export interface NutritionEstimateItem {
  name: string
  grams: number
  matched: boolean
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  source: NutriSource
  note?: string
}

export interface NutritionEstimate {
  items: NutritionEstimateItem[]
  totals: { kcal: number; protein: number; carb: number; fat: number; fiber: number }
  advice: string[]
  mealKcalTarget: number
  matchedCount: number
}

/* --------------------------- AI 饮食热量分析 --------------------------- */

/** AI 识别出的单个食物（weight/calories 可在结果表中编辑） */
export interface AnalysisFoodItem {
  name: string
  /** 估算重量（g） */
  weight: number
  unit: string
  /** 本项热量（kcal） */
  calories: number
  /** 每 100g 热量（kcal） */
  caloriesPer100g: number
  /** 置信度 0-1 */
  confidence: number
  /** 估算依据 / 备注 */
  remark: string
  protein?: number
  carb?: number
  fat?: number
  fiber?: number
}

export interface MealAnalysisResult {
  foods: AnalysisFoodItem[]
  totalCalories: number
  analysisSummary: string
  /** 不确定因素（如用油量无法判断） */
  uncertainties: string[]
  /** 图文冲突提示 */
  conflictWarnings?: string[]
  /** vision-model=图片+文字 / text-only=纯文字（图片未参与）/ demo=演示数据 */
  engine?: 'vision-model' | 'text-only' | 'demo'
  model?: string
}

/** 助手「自动记录一餐」的结果（与后端 executeRecordMeal 对齐） */
export interface RecordMealResult {
  ok: boolean
  date: string
  mealType: MealType
  label: string
  description: string
  count: number
  unmatched: number
  /** true 表示数据来自助手对话里已算出的 items（直接落库，未二次估算） */
  fromAssistant?: boolean
  totals: { kcal: number; protein: number; carb: number; fat: number; fiber: number }
  items: {
    name: string
    grams: number
    kcal: number
    protein: number
    fat: number
    carb: number
    fiber: number
    basis: string
    source: string
  }[]
  ids: number[]
  error?: string
}

/** 登录用户（不含密码等敏感字段） */
export interface AuthUser {
  id: number
  username: string
  nickname: string
  created_at: string
}

/** 登录 / 注册成功返回 */
export interface LoginResult {
  ok: boolean
  token: string
  user: AuthUser
}
