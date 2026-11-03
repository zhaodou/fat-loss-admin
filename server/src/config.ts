import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 项目根目录（fat-loss-admin） */
export const ROOT_DIR = path.resolve(__dirname, '../..')

/** 数据目录：SQLite 文件与上传的餐食照片都存在这里 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data')

export const DB_FILE = path.join(DATA_DIR, 'fatloss.db')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

export const PORT = Number(process.env.PORT || 4318)

/** 是否在首次建库时写入 21 天演示数据（方便一打开就有东西看） */
export const SEED_DEMO = process.env.SEED_DEMO !== 'false'

/** 是否启动时顺带托管前端构建产物（生产模式） */
export const SERVE_WEB_DIST = process.env.SERVE_WEB_DIST !== 'false'

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** 1 kg 脂肪约等于 7700 kcal */
export const KCAL_PER_KG_FAT = 7700

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

export interface EnergySettings {
  /** 非运动活动系数：只反映工作生活走动，不含刻意运动，避免与运动消耗重复计算 */
  activityLevel: keyof typeof ACTIVITY_LEVELS
  bmrFormula: 'auto' | 'mifflin' | 'katch'
  /**
   * 运动消耗计入方式：
   * true（默认，推荐）= 运动时段从日常消耗中剔除，只按 MET 计一次，绝不重复计算；
   * false = 在完整日常消耗之上再叠加运动消耗（会重复计算运动时段的静息代谢）。
   */
  deductExerciseBaseline: boolean
  intensityFactor: { low: number; moderate: number; high: number }
  /** 单日缺口上限比例（相对 TDEE） */
  maxDeficitRatio: number
  /** 单日缺口上限绝对值 kcal */
  maxDeficitKcal: number
  /** 摄入下限，低于此值视为过度节食 */
  minIntakeMale: number
  minIntakeFemale: number
  /** 蛋白质目标 g / kg 体重 */
  proteinPerKg: number
}

/**
 * 关键设计：这里的系数是「非运动活动系数（NEAT）」。
 * 常见表格里的 1.55/1.725 已经把“每周训练 3-5 次”算进去了，
 * 如果我们再用它算 TDEE，又单独加一次运动消耗，就会重复计算。
 * 所以本系统统一使用不含运动的系数，运动消耗按 MET 单独累加。
 */
export const ACTIVITY_LEVELS = {
  sedentary: { label: '久坐办公（几乎不走动）', factor: 1.2 },
  light: { label: '轻度活动（通勤 + 日常走动）', factor: 1.3 },
  moderate: { label: '中度活动（走动较多的岗位）', factor: 1.4 },
  active: { label: '高强度活动（体力工作 / 日均 1.5 万步）', factor: 1.5 },
} as const

export const defaultEnergySettings: EnergySettings = {
  activityLevel: 'light',
  bmrFormula: 'auto',
  deductExerciseBaseline: true,
  intensityFactor: { low: 0.85, moderate: 1, high: 1.2 },
  maxDeficitRatio: 0.25,
  maxDeficitKcal: 750,
  minIntakeMale: 1500,
  minIntakeFemale: 1200,
  proteinPerKg: 1.6,
}

/**
 * 「我的助手」的模型连接配置。
 * 全部走 OpenAI 兼容的 /chat/completions 协议，换供应商只需要改 endpoint + model。
 */
export interface AssistantSettings {
  provider: string
  model: string
  endpoint: string
  apiKey: string
  temperature: number
  tone: 'strict' | 'encouraging' | 'neutral'
  /**
   * 视觉模型（可选）：用于「AI 饮食热量分析」里识别饮食照片。
   * 留空 = 用主模型尝试（主模型需支持图片），识别失败自动降级为纯文字分析。
   * 例：智谱可填 glm-4v-flash（免费），复用同一个 API Key。
   */
  visionModel?: string
}

export interface AppSettings {
  units: { weight: 'kg' | 'jin'; length: 'cm' | 'inch'; energy: 'kcal' | 'kj' }
  energy: EnergySettings
  privacy: { hideWeight: boolean; maskPhotos: boolean; localOnly: boolean }
  ai: AssistantSettings
  demoSeeded: boolean
}

export const defaultSettings: AppSettings = {
  units: { weight: 'kg', length: 'cm', energy: 'kcal' },
  energy: defaultEnergySettings,
  privacy: { hideWeight: false, maskPhotos: false, localOnly: true },
  ai: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    temperature: 0.4,
    tone: 'encouraging',
    visionModel: '',
  },
  demoSeeded: false,
}

export interface LlmPresetDef {
  id: string
  name: string
  endpoint: string
  model: string
  models: string[]
  hint: string
  /** 零成本：完全免费，或有长期免费额度 */
  free?: boolean
  /** 不需要 API Key（演示模式 / 本地模型） */
  needKey?: boolean
  /** 需要额外注意的地方，选中后在配置面板里提示 */
  note?: string
}

/**
 * 供应商预设，前端配置面板直接展示成选项。
 * 顺序即推荐顺序：先「不花钱就能跑」的，再是需要充值或科学网络的。
 */
export const LLM_PRESETS: LlmPresetDef[] = [
  {
    id: 'demo',
    name: '演示模式（不填 Key，先看效果）',
    endpoint: '',
    model: 'demo-nutrition-v1',
    models: ['demo-nutrition-v1'],
    hint: '内置样例回答，零成本零配置，用来看排版和交互',
    free: true,
    needKey: false,
    note:
      '演示模式的回答由本机内置的营养样例库生成，不是真实大模型。它能完整演示四段式输出、热量拆解和结合你档案的建议，' +
      '但食物覆盖面有限、不会真正推理。确认满意后再换成下方任一个免费额度平台即可。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM（GLM-4-Flash 永久免费）',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-flash-250414', 'glm-4-plus', 'glm-4-air'],
    hint: '推荐首选：glm-4-flash 本身永久免费，注册还送 2000 万 token',
    free: true,
    note: 'open.bigmodel.cn 手机号注册即可拿 Key，glm-4-flash 不充值也能长期调用。',
  },
  {
    id: 'ollama',
    name: '本地 Ollama（完全免费，不联网）',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen2.5:3b', 'llama3.1:8b', 'gemma2:9b'],
    hint: '自己电脑跑，不需要注册也不需要 Key，数据完全不出本机',
    free: true,
    needKey: false,
    note: '先装 Ollama 并执行 ollama pull qwen2.5:7b（约 4.7 GB）。7B 模型在 16 GB 内存的机器上可用，回答质量接近小模型上限。',
  },
  {
    id: 'volcengine',
    name: '火山方舟（豆包，每日 200 万 token 免费）',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: '',
    models: [],
    hint: '每天自动刷新 200 万 token，免费额度里日配额最大',
    free: true,
    note: '模型名要填你在方舟控制台创建的「接入点 ID」（形如 ep-2024xxxx-xxxxx），并且必须先在模型广场手动开通模型，否则有 Key 也调不通。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow（注册送 2000 万 token）',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen3-8B', 'deepseek-ai/DeepSeek-V3'],
    hint: '一个 Key 打通几十个开源模型，新用户 2000 万 token',
    free: true,
    note: '注册+实名送 2000 万 token。注意免费只覆盖部分小模型，调用前在官网确认当前免费清单。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek（新用户送体验额度）',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: '性价比高，中文营养问答表现稳定',
    free: true,
    note: '新注册用户有几十万到几百万 token 的赠送额度（有有效期），官方单价很低，用完后按量付费也就几毛钱。',
  },
  {
    id: 'dashscope',
    name: '通义千问（阿里百炼）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    hint: '国内直连，中文食物与菜名理解好',
  },
  {
    id: 'moonshot',
    name: 'Kimi（月之暗面）',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    hint: '长上下文，适合贴一大段饮食记录一起分析',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
    hint: '需要能访问 openai.com 的网络环境',
  },
  {
    id: 'custom',
    name: '自定义（任意 OpenAI 兼容接口）',
    endpoint: '',
    model: '',
    models: [],
    hint: 'vLLM / LM Studio / 自建网关 / 学校或公司的内部模型',
  },
]
