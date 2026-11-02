/**
 * 「我的助手」：对话式营养顾问
 * ---------------------------------------------------------------------------
 * 和 /api/advice 的分工要分清：
 *   - advice 是规则引擎，读本机数据算，结论可追溯、可复现，用来「管住」减脂节奏；
 *   - assistant 是 LLM 对话，回答来自模型自身的营养学知识，**不查本机食物库**。
 *     问「100 g 西红柿多少卡」时，答案是模型给出的估算，而不是 SELECT 一条记录。
 *
 * 这一层只做三件事：
 *   1) 把用户档案 + 近期记录拼成上下文（个性化建议的依据）；
 *   2) 用系统提示词约束输出结构、估算标注、安全边界；
 *   3) 把 OpenAI 兼容接口的流式响应透传给上层。
 */
import { ACTIVITY_LEVELS, LLM_PRESETS, MEAL_LABEL, MEAL_TYPES, type AssistantSettings, type MealType } from '../config'
import { db, getSettings } from '../db'
import { ageFromBirth, bmi, bmiCategory, calcBmr, round } from './energy'
import { getActiveGoal, getPlan, getProfile, weightOn } from './data'
import { insertDietEntries, upsertDietEntriesByMeal } from './diet'
import { estimateDiet, findLocal } from './nutrition'
import { localDateStr, shiftDate } from './trend'
import { DEMO_MODEL, streamDemo } from './demo-brain'

export type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ResolvedLlm {
  provider: string
  providerName: string
  endpoint: string
  model: string
  apiKey: string
  temperature: number
  tone: AssistantSettings['tone']
  /** 配置来自环境变量还是本机设置 */
  source: 'env' | 'settings'
  ready: boolean
  missing: string[]
}

/** 本地自己跑的服务（Ollama / vLLM / LM Studio）通常不需要 key */
function isLocalEndpoint(endpoint: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i.test(endpoint)
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

/**
 * 解析当前生效的模型连接。
 * 环境变量优先于界面配置，方便用 .env 或 CI 覆盖而不改动数据库。
 */
export function resolveLlm(): ResolvedLlm {
  const ai = getSettings().ai ?? ({} as AssistantSettings)
  const preset = LLM_PRESETS.find((p) => p.id === ai.provider)
  const env = process.env

  /**
   * 演示模式：不走网络、不需要 Key，恒定可用。
   * 这样新用户打开页面就能先看到完整效果，再决定要不要去注册免费额度。
   */
  if (ai.provider === 'demo') {
    return {
      provider: 'demo',
      providerName: '演示模式',
      endpoint: '',
      model: DEMO_MODEL,
      apiKey: '',
      temperature: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.4,
      tone: ai.tone || 'encouraging',
      source: 'settings',
      ready: true,
      missing: [],
    }
  }

  const endpoint = String(env.ASSISTANT_ENDPOINT || ai.endpoint || preset?.endpoint || '').trim()
  const model = String(env.ASSISTANT_MODEL || ai.model || preset?.model || '').trim()
  const apiKey = String(env.ASSISTANT_API_KEY || ai.apiKey || '').trim()

  const missing: string[] = []
  if (!endpoint) missing.push('接口地址')
  if (!model) missing.push('模型名称')
  if (!apiKey && !isLocalEndpoint(endpoint)) missing.push('API Key')

  return {
    provider: ai.provider || 'custom',
    providerName: preset?.name || '自定义',
    endpoint,
    model,
    apiKey,
    temperature: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.4,
    tone: ai.tone || 'encouraging',
    source: env.ASSISTANT_API_KEY ? 'env' : 'settings',
    ready: missing.length === 0,
    missing,
  }
}

/* ------------------------------ 上下文拼装 ------------------------------ */

const TONE_RULES: Record<AssistantSettings['tone'], string> = {
  strict:
    '语气：直接、就事论事，该纠正就纠正，不铺垫、不安慰；对「今天多吃一顿没关系」这类想法要点明代价。',
  encouraging:
    '语气：温和但不含糊，先肯定做到的部分，再指出该改的地方；不喊口号，不制造焦虑。',
  neutral: '语气：客观中立，像营养咨询记录，只陈述事实与建议。',
}

const SYSTEM_RULES = `你是 FitPilot 的「我的助手」，一位有注册营养师背景、长期做体重管理的饮食顾问。

【最重要的原则：回答来自你的营养学知识，不是查数据库】
你的营养数值来自你自身的营养学知识（中国食物成分表、USDA 等量级常识），不是从本机食物库里检索的。
因此：所有数值都要以「估算」表述，并交代估算依据；不要把数字说成「查到的准确值」。
当本机数据能提供个性化依据时（体重、TDEE、近期摄入），可以用它来分析你的饮食结构，但食物营养值仍由你判断。

【不确定时怎么办】
用户只说了「一个西红柿」没说重量，或没说烹饪方式、是否放油、有没有配料时：
先按最常见情况给出**明确假设下的估算**（例：中等大小西红柿约 150 g，生食，未加油），把假设写清楚；
然后最多追问 1–2 个真正影响结果的关键信息（重量？炒的还是生的？放了多少油？）。
绝对不要为了追问而不给答案，也不要在假设没写清楚的情况下甩一个数字。

【能力范围】
1. 食物热量计算
   - 给出总能量（kcal），并写明依据：每 100 g 基准能量 × 实际重量 × 烹饪系数。
   - 参考烹饪系数：蒸/煮 1.0，快炒 1.1–1.2，红烧/干锅 1.2–1.35，油炸 1.3–1.5；另加的油、糖、酱料单独列出，不要笼统计入系数。
   - 生熟差异必须说明：生米约 346 kcal/100 g，熟米饭约 116 kcal/100 g；生面条约 286 kcal/100 g，煮熟约 110–140 kcal/100 g。
2. 营养成分分析
   - 必给：蛋白质、脂肪、碳水化合物、膳食纤维。
   - 再按食物特点补 2–4 个有代表性的微量营养素，不要机械罗列一整张成分表。例：菠菜→叶酸、维生素 K、钾；三文鱼→维生素 D、EPA/DHA；瘦牛肉→血红素铁、锌、维生素 B12；豆腐→钙（卤水/石膏点制）、大豆异黄酮。
3. 营养价值解读
   - 解释主要营养素的生理作用（一句话讲清「它在这份食物里起什么作用」）。
   - 说明这份食物的营养特点、适合谁吃、谁要少吃、怎么搭配更合理。
   - 不夸大单一食物功效：不说「吃 X 就能瘦 / 降血脂 / 抗癌」；不制造「超级食物」概念。
4. 个性化饮食建议
   - 结合下方【用户档案】【最近 7 天记录】【今天已记录】，指出当前饮食结构的问题：蛋白够不够、蔬菜量与种类、精制碳水比例、油盐与外卖频率、晚餐时间、加餐质量。
   - 给 2–4 条能立刻执行的具体动作，要带数量和位置：例如「午餐加 150 g 鸡胸或 2 个鸡蛋，把白米饭从 200 g 减到 150 g」「下午加餐把饼干换成 200 g 无糖酸奶 + 10 g 坚果」。
   - 不要给「少吃多动」「注意饮食均衡」这种无法执行的建议。
5. 减脂饮食管理
   - 用三个维度比较食物：热量密度（kcal/100 g）、蛋白质密度、饱腹感（体积、纤维、水分、咀嚼感、消化速度）。
   - 给份量建议时说明理由，而不是只给数字。
   - 明确反对过度节食：女性每日摄入不低于 1200 kcal，男性不低于 1500 kcal；每日缺口不超过 TDEE 的 25%（也不超过 750 kcal）。若用户提出的方案突破这条线，要直接指出来并给替代方案。
6. 结果表达
   - 用 Markdown：小标题、分点、表格。
   - 表格用标准 Markdown 表格语法（| 列 | 列 | 加分隔行）。
   - 可靠数据与估算分开标注：来自用户档案/记录的用「记录值」，你推算的用「估算值」。
   - 热量取整，营养素保留 1 位小数。不要用 emoji 堆砌。

【每次食物分析至少包含四块】
### 1. 热量与估算依据
（总热量 + 假设 + 逐项拆解，可含小表格）
### 2. 主要营养成分与营养价值
（表格：营养素 | 含量 | 占每日参考摄入 | 在这份食物里的作用）
### 3. 营养特点与注意事项
（适合谁、注意什么、常见误区）
### 4. 结合你目标的建议
（针对当前减脂目标的具体动作）

如果用户只是闲聊、问概念、或做简短追问，不必硬套四块结构，自然、简洁地回答即可。

【记录到「每日饮食」时】
- 当用户说"记录 / 保存 / 记一下 / 添加到"某一天的某一餐时，必须调用 record_meal 工具。
- **绝不能只用文字说"已记录成功 / 已保存"而不调用工具**——不调用工具的话，数据根本不会写入「每日饮食」，用户去查看时会发现没记录，这是严重错误。
- 调用时必须把你刚才算出的每一项数值（热量、蛋白质、脂肪、碳水、纤维）和估算依据，原样填进 items 参数；**不要重新算一遍，也不要只传描述让系统去猜**——否则记下来的会和你说的不一致。
- 如果用户在同一句话里既让你"计算"又让你"记录"（例如"计算热量糖分，并记录到27号加餐"），直接在这次工具调用里带好 items 一并记录，不要分两次、也不要只回复不调工具。
- 如果用户还没让你算过这餐，先给出带数值的计算，等用户确认"记录"时再调用工具并带上刚才算出的 items。

【安全边界】
- 不做疾病诊断，不开处方。涉及肾病、糖尿病、痛风、甲状腺疾病、孕期哺乳期、进食障碍、正在服药等情况，说明需要线下就医或临床营养师介入，只给一般性饮食原则。
- 不推荐任何减肥药、代餐产品、极端断食法（如连续 24 小时以上断食、单一食物减肥法）。
- 用户表现出对体重的强烈焦虑或暴食/催吐倾向时，先共情，再明确建议寻求专业帮助，不要继续给减脂方案。`

function ageText(birthDate: string): string {
  try {
    return `${ageFromBirth(birthDate)} 岁`
  } catch {
    return '年龄未知'
  }
}

/** 把档案、计划、目标、近期记录整理成一段上下文 */
export function buildContextBlock(): string {
  const profile = getProfile()
  const plan = getPlan()
  const settings = getSettings()
  const today = localDateStr(new Date())
  const yesterday = shiftDate(today, -1)
  const from = shiftDate(today, -6)

  const bmr = calcBmr(profile, settings, new Date()).bmr
  const activityFactor = ACTIVITY_LEVELS[settings.energy.activityLevel]?.factor ?? 1.3
  const currentWeight = weightOn(today).weight_kg
  const bmiValue = bmi(currentWeight, profile.height_cm)

  /* 近期饮食 */
  const dietDays = db
    .prepare(
      `SELECT date, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(carb) AS carb,
              SUM(fat) AS fat, SUM(fiber) AS fiber, COUNT(*) AS items
       FROM diet_entries WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`,
    )
    .all(from, today) as { date: string; kcal: number; protein: number; carb: number; fat: number; fiber: number; items: number }[]

  /* 近期运动 */
  const workoutDays = db
    .prepare(
      `SELECT date, SUM(kcal) AS kcal, SUM(duration_min) AS minutes, COUNT(*) AS n
       FROM workouts WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`,
    )
    .all(from, today) as { date: string; kcal: number; minutes: number; n: number }[]

  const workoutKcal = workoutDays.reduce((s, d) => s + (d.kcal || 0), 0)
  const workoutMinutes = workoutDays.reduce((s, d) => s + (d.minutes || 0), 0)
  const tdee = round(bmr * activityFactor + workoutKcal / 7)

  /* 体重 */
  const weights = db
    .prepare(`SELECT date, weight_kg FROM body_records WHERE date >= ? AND date <= ? ORDER BY date`)
    .all(from, today) as { date: string; weight_kg: number }[]
  const weightTrend =
    weights.length >= 2
      ? `7 天内 ${weights.length} 条记录，从 ${weights[0].weight_kg} kg 到 ${weights[weights.length - 1].weight_kg} kg（变化 ${
          Math.round((weights[weights.length - 1].weight_kg - weights[0].weight_kg) * 10) / 10
        } kg）`
      : weights.length === 1
        ? `仅 1 条记录：${weights[0].weight_kg} kg（${weights[0].date}）`
        : '7 天内没有体重记录'

  /* 今天 */
  const todayEntries = db
    .prepare(`SELECT meal_type, food_name, amount_g, kcal, food_kind FROM diet_entries WHERE date = ? ORDER BY id`)
    .all(today) as { meal_type: string; food_name: string; amount_g: number; kcal: number; food_kind: string }[]

  const MEAL_LABEL: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }
  const todayLines = todayEntries.length
    ? todayEntries
        .map(
          (e) =>
            `  - ${MEAL_LABEL[e.meal_type] ?? e.meal_type}：${e.food_name} ${Math.round(e.amount_g)} g，${Math.round(e.kcal)} kcal${
              e.food_kind === 'dish' ? '（组合餐食）' : ''
            }`,
        )
        .join('\n')
    : '  - 还没有任何记录'

  const goal = getActiveGoal()
  const goalText = goal
    ? `目标 ${goal.target_weight} kg，目标日期 ${goal.target_date}，还需减 ${Math.round((currentWeight - goal.target_weight) * 10) / 10} kg`
    : '尚未设定目标体重'

  const avg = dietDays.length
    ? {
        kcal: Math.round(dietDays.reduce((s, d) => s + d.kcal, 0) / dietDays.length),
        protein: round(dietDays.reduce((s, d) => s + d.protein, 0) / dietDays.length, 1),
        carb: round(dietDays.reduce((s, d) => s + d.carb, 0) / dietDays.length, 1),
        fat: round(dietDays.reduce((s, d) => s + d.fat, 0) / dietDays.length, 1),
        fiber: round(dietDays.reduce((s, d) => s + d.fiber, 0) / dietDays.length, 1),
      }
    : null

  return `【当前日期】今天是 ${today}（即 ${localDateStr(new Date())}），昨天是 ${yesterday}。记录"每日饮食"时用这个日期。

【用户档案】（记录值）
- ${profile.nickname || '用户'}，${profile.gender === 'male' ? '男' : '女'}，${ageText(profile.birth_date)}
- 身高 ${profile.height_cm} cm，体重 ${currentWeight} kg，BMI ${bmiValue}（${bmiCategory(bmiValue).label}）${
    profile.body_fat_pct ? `，体脂率 ${profile.body_fat_pct}%` : ''
  }
- 活动水平：${ACTIVITY_LEVELS[settings.energy.activityLevel]?.label ?? '轻度活动'}；基础代谢约 ${Math.round(bmr)} kcal，日均总消耗约 ${tdee} kcal
- ${goalText}
- 作息：${plan.wake_time} 起床，${plan.work_start}–${plan.work_end} 上班，午休 ${plan.lunch_start}–${plan.lunch_end}（吃饭约 ${plan.meal_minutes} 分钟），${plan.dinner_time} 晚餐，${plan.sleep_time} 睡
- 饮食偏好：${plan.diet_pref?.style || '未填写'}${plan.diet_pref?.avoid?.length ? `；不吃 ${plan.diet_pref.avoid.join('、')}` : ''}
- 蛋白目标 ${round(currentWeight * settings.energy.proteinPerKg, 1)} g/天；摄入下限 ${profile.gender === 'male' ? settings.energy.minIntakeMale : settings.energy.minIntakeFemale} kcal/天

【最近 7 天记录】（记录值，${from} ~ ${today}）
- 饮食：${dietDays.length}/7 天有记录${
    avg ? `，有记录日平均摄入 ${avg.kcal} kcal（蛋白 ${avg.protein} g / 碳水 ${avg.carb} g / 脂肪 ${avg.fat} g / 纤维 ${avg.fiber} g）` : '，暂无数据'
  }
- 运动：${workoutDays.length} 天共 ${workoutMinutes} 分钟，约 ${Math.round(workoutKcal)} kcal
- 体重：${weightTrend}

【今天已记录】（记录值，${today}）
${todayLines}

（以上为本机记录，仅用于判断你的饮食结构和节奏；回答食物营养值时请用你自己的营养学知识估算。）`
}

export function systemPrompt(): string {
  const { tone } = resolveLlm()
  return `${SYSTEM_RULES}

${TONE_RULES[tone] ?? TONE_RULES.encouraging}

${buildContextBlock()}`
}

/* ------------------------------- 流式调用 ------------------------------- */

export class LlmError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

function extractError(body: string, status: number): string {
  try {
    const json = JSON.parse(body)
    const msg = json?.error?.message || json?.message || json?.error
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  } catch {
    /* 不是 JSON，直接用原文 */
  }
  return body.trim().slice(0, 300) || `模型接口返回 ${status}`
}

/** 把上游错误翻译成用户能看懂的话 */
function humanize(message: string, status: number): string {
  const m = message.toLowerCase()
  if (status === 401 || m.includes('invalid api key') || m.includes('unauthorized') || m.includes('authentication'))
    return 'API Key 无效或已过期，请到「助手设置」里重新填写'
  if (status === 402 || m.includes('insufficient') || m.includes('quota') || m.includes('balance'))
    return '账户余额或额度不足，请充值后再试'
  if (status === 403) return '这个 Key 没有调用该模型的权限'
  if (status === 404) return '接口地址或模型名称不对，请检查「助手设置」里的地址与模型'
  if (status === 429 || m.includes('rate limit')) return '请求太频繁或超出并发限制，稍等几秒再试'
  if (status === 400 && (m.includes('model') || m.includes('not exist'))) return '模型名称不存在，请检查模型名是否正确'
  if (m.includes('timeout') || m.includes('etimedout')) return '模型响应超时，可能是网络问题，请重试'
  if (m.includes('fetch failed') || m.includes('enotfound') || m.includes('econnrefused'))
    return '连不上模型接口，检查网络或接口地址（本地模型确认服务已启动）'
  return message
}

/* --------------------------- 助手"自动记录餐"工具 --------------------------- */

/** OpenAI 兼容的 function calling 工具定义：把一顿饭记到指定日期/餐次 */
export const RECORD_MEAL_TOOL = {
  type: 'function',
  function: {
    name: 'record_meal',
    description:
      '把用户描述的一餐记录到「每日饮食」里指定的日期和餐次。' +
      '【最重要】一旦你决定帮用户记录（用户说"记录 / 保存 / 记一下 / 添加 / 记到"某一天的某一餐，或你在本轮已经算完并说"已记录/已保存"），**必须调用本工具**，' +
      '绝不能用文字说"已记录成功"却不调用——不调用工具，数据不会真正保存。' +
      '【数据来源】优先使用你在本轮或上一条回复中已经算出的各项营养数据（热量、蛋白质、脂肪、碳水、膳食纤维，以及估算依据），原样填进 items 参数，' +
      '**不要重新估算、不要改用其它来源的数据**。如果你已经算好了数值，把 items 带上最准确；如果这条消息里你既算了又说了记录，就在同一个工具调用里带上 items。' +
      '如果实在没有逐项数值，也可以只传 date/meal_type/description 三项，系统会用估算兜底——但你本来计算过的数字更准确，建议优先带上。' +
      '仅当用户明确要求"记录 / 保存 / 添加 / 记一下"某一天的某一餐时才调用；只是分析热量、没说要记的时候不要调用。',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '目标日期，格式 YYYY-MM-DD。用户说"今天/今日"用今天的日期，"昨天"用昨天的日期；没提日期默认用今天。',
        },
        meal_type: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
          description: '早餐 breakfast / 午餐 lunch / 晚餐 dinner / 加餐 snack。按用户说的早/午/晚/加对应。',
        },
        description: {
          type: 'string',
          description: '这餐的食物描述（简洁、以食物为主），从对话里提炼出用户实际吃了什么，例如"一个烧饼,100g卤菜,100g生胡萝卜,100g带骨头猪蹄"。',
        },
        items: {
          type: 'array',
          description:
            '这一餐的每一项食物，**强烈建议用你前面已经算出的数据原样填写，不要改动任何数值**。每一项都要有名称和重量，以及你已给出的热量/蛋白质/脂肪/碳水/纤维，并写下你当时的估算依据。（可选：没给逐项数值时可省略，系统会用估算兜底）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '食物名称' },
              grams: {
                type: 'number',
                description: '份量（克）。如果描述里没给重量（如"一个烧饼"），用你前面假设的重量填写，并在 basis 里说明你的假设',
              },
              kcal: { type: 'number', description: '这一项的热量 kcal，用你已经算出的数字' },
              protein: { type: 'number', description: '蛋白质 g，用你已经算出的数字' },
              fat: { type: 'number', description: '脂肪 g，用你已经算出的数字' },
              carb: { type: 'number', description: '碳水化合物 g，用你已经算出的数字' },
              fiber: { type: 'number', description: '膳食纤维 g，没估算就填 0' },
              basis: {
                type: 'string',
                description: '这一项的估算依据，一句话，例如"烧饼约250kcal/100g，整只约100g"或"带骨猪蹄可食部约60%，按可食部重量估算"',
              },
            },
            required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carb', 'fiber'],
          },
        },
      },
      required: ['date', 'meal_type', 'description'],
    },
  },
}

/** 助手在对话里已经算出的、准备落库的结构化食材项 */
export interface AssistantMealItem {
  name: string
  grams: number
  kcal: number
  protein: number
  fat: number
  carb: number
  fiber: number
  basis?: string
}

const FOOD_HINT =
  /(克|g|个|只|片|碗|杯|份|根|块|勺|把|ml|毫升|鸡|鸭|鱼|虾|肉|蛋|奶|豆|饭|面|饼|粥|包|馒头|三明治|汉堡|披萨|火锅|烧烤|外卖|食堂|套餐|西红柿|番茄|黄瓜|生菜|西兰花|菠菜|土豆|红薯|玉米|苹果|香蕉|橙子|橘|桃|梨|葡萄|芒果|草莓|西瓜|火龙果|猕猴桃|蓝莓|樱桃|柚子|木瓜|菠萝|柠檬|哈密瓜|椰子|荔枝|龙眼|牛油果|坚果|沙拉|酸奶|奶茶|可乐|咖啡|汤|炒菜|红烧|清蒸|油炸|便当|面包|蛋糕|水果|蔬菜)/

function mealByHour(): MealType {
  const h = new Date().getHours()
  if (h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 17) return 'snack'
  if (h < 21) return 'dinner'
  return 'snack'
}

export interface RecordMealResult {
  ok: boolean
  date: string
  mealType: MealType
  label: string
  description: string
  count: number
  unmatched: number
  /** true 表示数据来自助手对话里已算出的 items（直接落库，未二次估算）；false 表示走了兜底估算 */
  fromAssistant: boolean
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

/** 把任意值转成有限数字，避免模型把字符串 / null 写进来 */
function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 真正落库。
 * 优先使用助手在对话里已经算出的结构化 items——这样「记录的就是对话里给出的数据」，
 * 不会因为后端再估算一遍而产生偏差或漏匹配。只有没拿到 items（演示模式 / 模型没按要求传）时，
 * 才退回到 estimateDiet 估算作为安全网。每一项都带上原始描述 raw_text 与估算依据 basis，
 * 便于后续在「每日饮食」整体编辑 / 重算、并追溯来源。
 */
export async function executeRecordMeal(
  date: string,
  mealType: MealType,
  description: string,
  items?: AssistantMealItem[],
): Promise<RecordMealResult> {
  const meal = (MEAL_TYPES as readonly string[]).includes(mealType) ? mealType : 'lunch'

  // 情况一：助手已经算好，直接落库（保证记录 == 对话里给出的数据）
  if (items && items.length) {
    const rows = items.map((i) => ({
      meal_type: meal,
      food_name: String(i.name ?? '自定义食物').slice(0, 60) || '自定义食物',
      amount_g: toNum(i.grams),
      kcal: toNum(i.kcal),
      protein: toNum(i.protein),
      carb: toNum(i.carb),
      fat: toNum(i.fat),
      fiber: toNum(i.fiber),
      source: 'assistant',
      raw_text: description,
      basis: String(i.basis ?? '').slice(0, 200),
    }))
    // 宏量营养素补全：AI 若只给了热量（蛋白/脂肪/碳水/纤维都为 0，视为未提供），
    // 用本地营养库按重量把缺失的宏量补齐，保证单条记录与整餐 subtotal 完整；
    // AI 已明确给出的宏量一律保留，不被覆盖。
    for (const r of rows) {
      if (r.kcal > 0 && !(r.protein + r.carb + r.fat + r.fiber)) {
        const local = findLocal(r.food_name)
        if (local) {
          const f = r.amount_g / 100
          r.protein = Math.round(local.protein * f * 10) / 10
          r.carb = Math.round(local.carb * f * 10) / 10
          r.fat = Math.round(local.fat * f * 10) / 10
          r.fiber = Math.round(local.fiber * f * 10) / 10
          if (!r.basis) r.basis = 'AI 热量 + 本地库补全营养'
        }
      }
    }
    const ids = upsertDietEntriesByMeal(date, meal, rows)
    const totals = rows.reduce(
      (acc, r) => ({
        kcal: acc.kcal + r.kcal,
        protein: acc.protein + r.protein,
        carb: acc.carb + r.carb,
        fat: acc.fat + r.fat,
        fiber: acc.fiber + r.fiber,
      }),
      { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 },
    )
    const roundTotals = {
      kcal: Math.round(totals.kcal),
      protein: Math.round(totals.protein * 10) / 10,
      carb: Math.round(totals.carb * 10) / 10,
      fat: Math.round(totals.fat * 10) / 10,
      fiber: Math.round(totals.fiber * 10) / 10,
    }
    return {
      ok: true,
      date,
      mealType: meal,
      label: MEAL_LABEL[meal],
      description,
      count: rows.length,
      unmatched: 0,
      fromAssistant: true,
      totals: roundTotals,
      items: rows.map((r) => ({
        name: r.food_name,
        grams: r.amount_g,
        kcal: r.kcal,
        protein: r.protein,
        fat: r.fat,
        carb: r.carb,
        fiber: r.fiber,
        basis: r.basis,
        source: r.source,
      })),
      ids,
    }
  }

  // 情况二（兜底）：没有结构化 items 时，用估算接口算，仅作安全网
  const est = await estimateDiet(description, meal)
  const matched = est.items.filter((i) => i.matched)
  const ids = upsertDietEntriesByMeal(
    date,
    meal,
    matched.map((i) => ({
      meal_type: meal,
      food_name: i.name,
      amount_g: i.grams,
      kcal: i.kcal,
      protein: i.protein,
      carb: i.carb,
      fat: i.fat,
      fiber: i.fiber,
      source: i.source,
      raw_text: description,
    })),
  )
  return {
    ok: true,
    date,
    mealType: meal,
    label: MEAL_LABEL[meal],
    description,
    count: matched.length,
    unmatched: est.items.length - matched.length,
    fromAssistant: false,
    totals: est.totals,
    items: matched.map((i) => ({
      name: i.name,
      grams: i.grams,
      kcal: i.kcal,
      protein: i.protein,
      fat: i.fat,
      carb: i.carb,
      fiber: i.fiber,
      basis: '估算接口',
      source: i.source,
    })),
    ids,
  }
}

/** 演示模式下的意图识别：用户想记录某餐时就解析出 日期/餐次/食物描述 */
export function parseRecordIntent(text: string, prevUserText: string): { date: string; mealType: MealType; description: string } | null {
  const intentRe = /记(录|到|下来)|保存|存(入|进)?(到)?(饮食|记录|日记)?|添加.*(饮食|记录)|帮我记|录(入|进)?(到)?(饮食|记录)/
  if (!intentRe.test(text)) return null

  let mealType: MealType = mealByHour()
  if (/早(餐|饭)?/.test(text)) mealType = 'breakfast'
  else if (/午(餐|饭)?/.test(text)) mealType = 'lunch'
  else if (/晚(餐|饭)?/.test(text)) mealType = 'dinner'
  else if (/加(餐)?/.test(text)) mealType = 'snack'

  let date = localDateStr(new Date())
  if (/昨(天|日)?/.test(text)) date = shiftDate(date, -1)
  else if (/前(天|日)?/.test(text)) date = shiftDate(date, -2)
  else {
    const y = new Date().getFullYear()
    const m0 = text.match(/(\d{4})-(\d{2})-(\d{2})/) || prevUserText.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (m0) date = m0[0]
    else {
      const md = text.match(/(\d{1,2})月(\d{1,2})[日号]/) || prevUserText.match(/(\d{1,2})月(\d{1,2})[日号]/)
      if (md) {
        date = `${y}-${String(Number(md[1])).padStart(2, '0')}-${String(Number(md[2])).padStart(2, '0')}`
      } else {
        const d = text.match(/(\d{1,2})[号日]/) || prevUserText.match(/(\d{1,2})[号日]/)
        if (d) {
          const mm = String(new Date().getMonth() + 1).padStart(2, '0')
          date = `${y}-${mm}-${String(Number(d[1])).padStart(2, '0')}`
        }
      }
    }
  }

  // 描述：优先用本条消息里能识别为"食物"的内容；没有就从上一句用户消息取
  const description = FOOD_HINT.test(text) ? text : prevUserText
  if (!FOOD_HINT.test(description)) return null
  return { date, mealType, description }
}

/**
 * 从模型的回复文本里提取它已经算好的食物明细（兜底用）。
 * 当模型"计算了但没调 record_meal 工具"、又文字上说了"已记录"时，
 * 我们用它本轮回复里的数值直接落库，从而保证「记录的就是对话里给出的数据」。
 * 支持形如：`- **桃子（60g左右）**：约 80 kcal，蛋白质 1 g，脂肪 0.5 g，碳水化合物 2 g` 的行。
 */
export function extractItemsFromReply(text: string): AssistantMealItem[] {
  const items: AssistantMealItem[] = []
  const lines = String(text || '').split(/\r?\n/)
  const rowRe =
    /[*_]*([^*_\n（(]+?)[*_]*\s*[（(]\s*(\d+(?:\.\d+)?)\s*g[^）)]*[）)]\s*[*_]*\s*[:：]\s*约?\s*(\d+(?:\.\d+)?)\s*kcal/i
  for (const line of lines) {
    const m = line.match(rowRe)
    if (!m) continue
    const name = m[1].trim().replace(/^[*_\-\s]+/, '').replace(/[*_\s]+$/, '')
    if (!name) continue
    const grams = Number(m[2])
    const kcal = Number(m[3])
    if (!Number.isFinite(grams) || !Number.isFinite(kcal)) continue
    const numOf = (re: RegExp): number => {
      const mm = line.match(re)
      return mm ? Number(mm[1]) : 0
    }
    items.push({
      name,
      grams,
      kcal,
      protein: numOf(/蛋白[质]*[\s：:（(]*(\d+(?:\.\d+)?)/i),
      fat: numOf(/脂肪[\s：:（(]*(\d+(?:\.\d+)?)/i),
      carb: numOf(/碳水[化合物]*[\s：:（(]*(\d+(?:\.\d+)?)/i),
      fiber: numOf(/纤维[\s：:（(]*(\d+(?:\.\d+)?)/i),
      basis: '对话回复中提取的估算值',
    })
  }
  return items
}

/** 模型文字是否表达了「已记录 / 已保存」的确认（用于兜底判断） */
function looksLikeRecordConfirmation(text: string): boolean {
  return /(已?记录成功|已保存|已?帮你?记录|已记到|记到.{0,12}(中|里)|已?经?记录|已存入|保存成功|记录好了|已经记好|已添加到|已帮你存)/.test(
    text || '',
  )
}

/** 演示模式记录后的确认文案（含表格，符合现有 Markdown 渲染） */
export function buildRecordConfirmation(rec: RecordMealResult): string {
  if (!rec.ok || rec.count === 0) {
    return (
      `> 我试着把这一餐记到 **${rec.date} ${rec.label}**，但没能从描述里识别出可记录的食物。` +
      `你可以把食物写得更具体一点（例如「300g 米饭 + 100g 鸡腿」），或直接在「每日饮食」里用描述→计算来记录。`
    )
  }
  const lines: string[] = []
  lines.push(`> ✅ 已按对话里算出的数据记录到 **${rec.date} ${rec.label}**，共 ${rec.count} 项：`)
  lines.push('')
  lines.push('| 食物 | 份量 | 热量 | 蛋白 | 脂肪 | 碳水 | 纤维 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const it of rec.items) {
    lines.push(
      `| ${it.name} | ${it.grams} g | ${it.kcal} kcal | ${it.protein} g | ${it.fat} g | ${it.carb} g | ${it.fiber} g |`,
    )
  }
  const t = rec.totals
  lines.push(`| **合计** | | **${t.kcal} kcal** | ${t.protein} g | ${t.fat} g | ${t.carb} g | ${t.fiber} g |`)
  lines.push('')
  lines.push('到「每日饮食」里就能看到这一餐，也可以再整体编辑或重新计算。')
  return lines.join('\n')
}

export interface StreamResult {
  content: string
  model: string
  tokens: number
  /** 模型在流式过程中发起的工具调用（已累加完整参数）；没有则空数组 */
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

/**
 * 调用 OpenAI 兼容的 /chat/completions，逐段回调增量文本。
 * 兼容两种响应：正常流式（text/event-stream）与被网关降级成整体 JSON 的情况。
 */
export async function streamChat(opts: {
  messages: ChatMessage[]
  onDelta: (text: string) => void
  signal?: AbortSignal
  /** 提供给模型的工具（function calling）；省略则纯对话 */
  tools?: unknown[]
  /** 工具选择策略，默认 auto */
  toolChoice?: 'auto' | 'none'
}): Promise<StreamResult> {
  const cfg = resolveLlm()
  if (!cfg.ready) {
    throw new LlmError(`还没有配置模型：缺少${cfg.missing.join('、')}。在「助手设置」里填好后即可对话。`, 400)
  }

  /* 演示模式：本机内置样例生成，不走网络，不需要 Key（工具调用在路由层用意图识别模拟） */
  if (cfg.provider === 'demo') {
    return streamDemo({
      messages: opts.messages,
      onDelta: opts.onDelta,
      signal: opts.signal,
    })
  }

  /* 空闲超时兜底：超过 60 秒没有任何数据就中断，避免界面一直转圈 */
  const linked = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  const arm = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      linked.abort()
    }, 60000)
  }
  if (opts.signal) {
    if (opts.signal.aborted) linked.abort()
    else opts.signal.addEventListener('abort', () => linked.abort(), { once: true })
  }
  arm()

  try {
    let resp: Response
    try {
      resp = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: opts.messages,
          temperature: cfg.temperature,
          stream: true,
          ...(opts.tools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? 'auto' } : {}),
        }),
        signal: linked.signal,
      })
    } catch (err) {
      if (timedOut) throw new LlmError('模型 60 秒没有响应，请重试或换一个模型', 504)
      if ((err as Error).name === 'AbortError') throw err
      throw new LlmError('连不上模型接口，检查网络或接口地址（本地模型确认服务已启动）', 502)
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new LlmError(humanize(extractError(body, resp.status), resp.status), resp.status >= 500 ? 502 : resp.status)
    }

    const contentType = resp.headers.get('content-type') || ''

    /* 情况一：网关把 stream 忽略了，直接返回完整 JSON */
    if (contentType.includes('application/json')) {
      const json: any = await resp.json()
      const text: string = json?.choices?.[0]?.message?.content ?? ''
      if (!text) throw new LlmError('模型返回了空内容，请重试')
      opts.onDelta(text)
      return { content: text, model: json?.model || cfg.model, tokens: json?.usage?.total_tokens || 0 }
    }

    if (!resp.body) throw new LlmError('模型没有返回内容', 502)
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let tokens = 0
    let model = cfg.model
    let finished = false
    /** 流式累加的工具调用：按 index 归并 id / name / arguments */
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []

    while (!finished) {
      const { done, value } = await reader.read()
      arm()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          finished = true
          break
        }
        let json: any
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        if (json?.error) throw new LlmError(humanize(String(json.error.message ?? json.error), 502))
        if (json?.model) model = json.model
        const delta = json?.choices?.[0]?.delta
        const piece: string = typeof delta?.content === 'string' ? delta.content : ''
        if (piece) {
          content += piece
          opts.onDelta(piece)
        }
        const tc = delta?.tool_calls
        if (Array.isArray(tc)) {
          for (const call of tc) {
            const idx = typeof call?.index === 'number' ? call.index : 0
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (call.id) toolCalls[idx].id = call.id
            if (call.type) toolCalls[idx].type = call.type
            if (call.function?.name) toolCalls[idx].function.name += call.function.name
            if (typeof call.function?.arguments === 'string') toolCalls[idx].function.arguments += call.function.arguments
          }
        }
        if (json?.usage?.total_tokens) tokens = json.usage.total_tokens
      }
    }

    const validToolCalls = toolCalls.filter((t) => t.function?.name)
    if (!content.trim() && !validToolCalls.length) throw new LlmError('模型没有返回内容，可能是提示词被拦截或模型不支持该接口', 502)
    return { content, model, tokens, toolCalls: validToolCalls.length ? validToolCalls : undefined }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}

/** 把历史消息裁到 token 预算内：保留最近若干轮，超长内容截断 */
export function trimHistory(messages: ChatMessage[], maxChars = 12000): ChatMessage[] {
  const out: ChatMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    const len = m.content.length
    if (used + len > maxChars && out.length > 0) break
    out.unshift(m)
    used += len
  }
  return out
}
