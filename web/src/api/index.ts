import axios from 'axios'
import { ElMessage } from 'element-plus'
import type {
  AdvicePayload,
  AssistantConfig,
  AssistantMessage,
  AssistantThread,
  AuthUser,
  BodyPhoto,
  BodyResponse,
  Dashboard,
  DaySchedule,
  DietDay,
  EnergyAnalysis,
  Exercise,
  LoginResult,
  NutritionEstimate,
  NutritionEstimateItem,
  Plan,
  Profile,
  Settings,
  StatsReport,
  Workout,
  WorkoutSummary,
} from '@/types/api'

export const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

/** 登录令牌本地存储：API 拦截器读取，路由守卫判断登录态也读它，避免和 Pinia 时序耦合 */
const TOKEN_KEY = 'fatloss_token'
const USER_KEY = 'fatloss_user'
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
  getUser: (): AuthUser | null => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
    } catch {
      return null
    }
  },
  setUser: (u: AuthUser | null) => {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u))
    else localStorage.removeItem(USER_KEY)
  },
}

http.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) {
    config.headers = config.headers ?? {}
    ;(config.headers as Record<string, string>).Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    if (status === 401) {
      tokenStore.clear()
      tokenStore.setUser(null)
      const path = location.pathname
      if (path !== '/login' && path !== '/register') location.href = '/login'
    }
    const message = error?.response?.data?.error || error?.message || '请求失败'
    if (status !== 401) ElMessage.error(message)
    return Promise.reject(error)
  },
)

const get = async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
  const { data } = await http.get(url, { params })
  return data as T
}
const post = async <T>(url: string, body?: unknown): Promise<T> => {
  const { data } = await http.post(url, body)
  return data as T
}
const put = async <T>(url: string, body?: unknown): Promise<T> => {
  const { data } = await http.put(url, body)
  return data as T
}
const del = async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
  const { data } = await http.delete(url, { params })
  return data as T
}

export const api = {
  /* 基础 */
  profile: () => get<Profile>('/profile'),
  updateProfile: (body: Partial<Profile>) => put<{ ok: boolean }>('/profile', body),
  plan: () => get<Plan>('/plan'),
  updatePlan: (body: Partial<Plan>) => put<{ ok: boolean; plan: Plan }>('/plan', body),
  schedule: (date: string) => get<DaySchedule>('/plan/schedule', { date }),
  settings: () => get<Settings>('/settings'),
  updateSettings: (body: Partial<Settings>) => put<{ ok: boolean; settings: Settings }>('/settings', body),

  /* 仪表盘 & 分析 */
  dashboard: (date: string) => get<Dashboard>('/dashboard', { date }),
  energy: (date: string) => get<EnergyAnalysis>('/analysis/energy', { date }),
  stats: (granularity: 'week' | 'month' | 'year', date: string) =>
    get<StatsReport>('/stats', { granularity, date }),
  timeline: (date: string) => get<{ date: string; items: { time: string; type: string; title: string; value: string }[] }>('/timeline', { date }),

  /* 饮食 */
  dietDay: (date: string) => get<DietDay>('/diet/day', { date }),
  estimateDiet: (body: { text: string; mealType?: string }) => post<NutritionEstimate>('/nutrition/estimate', body),
  recalculateEstimate: (body: { items: NutritionEstimateItem[]; mealType?: string }) =>
    post<NutritionEstimate>('/nutrition/recalculate', body),
  addDietEntries: (body: unknown) => post<{ ok: boolean; ids: number[] }>('/diet/entries', body),
  replaceDietMeal: (body: { date: string; meal_type: string; raw_text?: string; items: unknown[] }) =>
    put<{ ok: boolean; ids: number[]; count: number }>('/diet/meal', body),
  deleteDietEntries: (body: { ids: number[] }) => post<{ ok: boolean; deleted: number }>('/diet/entries/delete', body),
  updateDietEntry: (id: number, body: unknown) => put<{ ok: boolean }>(`/diet/entries/${id}`, body),
  deleteDietEntry: (id: number) => del<{ ok: boolean }>(`/diet/entries/${id}`),
  clearDay: (date: string, meal?: string) => del<{ ok: boolean }>('/diet/day', meal ? { date, meal_type: meal } : { date }),
  copyDay: (from: string, to: string) => post<{ ok: boolean; copied: number }>('/diet/copy', { from, to }),
  uploadPhoto: (file: File, mealType: string, date: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('meal_type', mealType)
    form.append('date', date)
    return http.post('/diet/photo', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  deletePhoto: (id: number) => del<{ ok: boolean }>(`/diet/photo/${id}`),

  /* 运动 */
  workouts: (date: string) => get<{ date: string; items: Workout[] }>('/workouts', { date }),
  workoutRange: (start: string, end: string) => get<{ items: Workout[] }>('/workouts', { start, end }),
  addWorkout: (body: unknown) => post<{ ok: boolean; id: number; kcal: number }>('/workouts', body),
  updateWorkout: (id: number, body: unknown) => put<{ ok: boolean; kcal: number }>(`/workouts/${id}`, body),
  deleteWorkout: (id: number) => del<{ ok: boolean }>(`/workouts/${id}`),
  estimateWorkout: (body: unknown) =>
    post<{ weight: number; items: { name: string; met: number; minutes: number; intensity: string; kcal: number }[]; totalKcal: number }>(
      '/workouts/estimate',
      body,
    ),
  workoutSummary: (days: number, end: string) => get<WorkoutSummary>('/workouts/summary', { days, end }),

  /* 运动库 */
  exercises: (params: { keyword?: string; category?: string }) => get<Exercise[]>('/exercises', params),
  exerciseCategories: () => get<{ category: string; count: number }[]>('/exercises/categories'),
  createExercise: (body: Partial<Exercise>) => post<{ ok: boolean; id: number }>('/exercises', body),
  updateExercise: (id: number, body: Partial<Exercise>) => put<{ ok: boolean }>(`/exercises/${id}`, body),
  deleteExercise: (id: number) => del<{ ok: boolean }>(`/exercises/${id}`),

  /* 体重 */
  body: (days: number, end: string) => get<BodyResponse>('/body', { days, end }),
  saveBody: (body: unknown) => post<{ ok: boolean }>('/body', body),
  deleteBody: (id: number) => del<{ ok: boolean }>(`/body/${id}`),

  /* 体型照片 */
  bodyPhotos: (params?: { date?: string; start?: string; end?: string }) =>
    get<BodyPhoto[]>('/body/photos', params),
  uploadBodyPhoto: (file: File, view: 'front' | 'side' | 'back', date: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('view', view)
    form.append('date', date)
    return http.post('/body/photo', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  deleteBodyPhoto: (id: number) => del<{ ok: boolean }>(`/body/photo/${id}`),

  /* 目标 */
  goals: () => get<any[]>('/goals'),
  goalSuggestion: () => get<any>('/goals/suggestion'),
  createGoal: (body: unknown) => post<{ ok: boolean }>('/goals', body),
  updateGoal: (id: number, body: unknown) => put<{ ok: boolean }>(`/goals/${id}`, body),
  deleteGoal: (id: number) => del<{ ok: boolean }>(`/goals/${id}`),

  /* AI 顾问 */
  generateAdvice: (date: string) => post<AdvicePayload>('/advice', { date }),
  latestAdvice: (date?: string) => get<AdvicePayload | null>('/advice/latest', date ? { date } : {}),
  adviceHistory: () => get<any[]>('/advice/history'),

  /* 我的助手 */
  assistantConfig: () => get<AssistantConfig>('/assistant/config'),
  saveAssistantConfig: (body: unknown) =>
    put<{ ok: boolean; ready: boolean; missing: string[]; keyMasked: string; hasKey: boolean }>('/assistant/config', body),
  testAssistant: () => post<{ ok: boolean; model?: string; reply?: string; error?: string }>('/assistant/test'),
  assistantThreads: () => get<AssistantThread[]>('/assistant/threads'),
  createAssistantThread: (title?: string) => post<{ ok: boolean; id: number }>('/assistant/threads', { title }),
  assistantThread: (id: number) =>
    get<{ thread: AssistantThread; messages: AssistantMessage[] }>(`/assistant/threads/${id}`),
  renameAssistantThread: (id: number, title: string) => http.patch(`/assistant/threads/${id}`, { title }).then((r) => r.data),
  deleteAssistantThread: (id: number) => del<{ ok: boolean }>(`/assistant/threads/${id}`),

  /* 数据 */
  exportData: () => http.get('/data/export').then((r) => r.data),
  importData: (body: unknown) => post<{ ok: boolean }>('/data/import', body),
  resetData: (keepLibrary = true) => post<{ ok: boolean }>('/data/reset', { keepLibrary }),

  /* 账号 / 登录 */
  login: (username: string, password: string) => post<LoginResult>('/auth/login', { username, password }),
  register: (username: string, password: string, nickname?: string) =>
    post<LoginResult>('/auth/register', { username, password, nickname }),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => get<AuthUser>('/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    put<{ ok: boolean }>('/auth/password', { oldPassword, newPassword }),
  updateNickname: (nickname: string) => put<{ ok: boolean; user: AuthUser }>('/auth/profile', { nickname }),
}
