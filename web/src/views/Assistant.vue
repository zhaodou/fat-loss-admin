<template>
  <div class="assistant-page">
    <!-- 左：会话列表 -->
    <aside class="threads">
      <div class="threads-head">
        <span class="threads-title">对话</span>
        <el-button size="small" type="primary" :icon="Plus" circle @click="newThread" />
      </div>

      <el-scrollbar class="thread-scroll">
        <div
          v-for="t in threads"
          :key="t.id"
          class="thread"
          :class="{ active: t.id === currentId }"
          @click="openThread(t.id)"
        >
          <div class="thread-main">
            <div class="thread-name">{{ t.title }}</div>
            <div class="thread-preview">{{ t.preview || '还没有消息' }}</div>
          </div>
          <el-dropdown trigger="click" @command="(cmd: string) => onThreadCommand(cmd, t)" @click.stop>
            <el-icon class="thread-more" @click.stop><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <div v-if="!threads.length" class="thread-empty">还没有对话<br />点右上角 + 开始</div>
      </el-scrollbar>

      <div class="threads-foot">
        <span class="dot" :class="isDemo ? 'demo' : config?.ready ? 'ok' : 'warn'" />
        <span class="tiny">{{ statusText }}</span>
      </div>
    </aside>

    <!-- 右：对话区 -->
    <section class="chat">
      <header class="chat-head">
        <div class="chat-title">
          <el-icon class="chat-icon"><ChatDotRound /></el-icon>
          <div>
            <div class="chat-name">我的助手</div>
            <div class="tiny muted">食物热量 · 营养分析 · 减脂建议，回答由模型生成</div>
          </div>
        </div>
        <div class="chat-actions">
          <el-tag v-if="isDemo" size="small" round effect="plain" type="warning">演示模式</el-tag>
          <el-tag v-else-if="config?.ready" size="small" round effect="plain" type="success">
            {{ config.model }}
          </el-tag>
          <el-tag v-else size="small" round effect="plain" type="info">未连接模型</el-tag>
          <el-button size="small" :icon="Setting" @click="openConfig">助手设置</el-button>
        </div>
      </header>

      <el-alert
        v-if="config && !config.ready"
        class="no-config"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #title>
          还没有连接对话模型（缺少{{ config.missing.join('、') }}）
        </template>
        <div class="alert-body">
          助手要一个大模型来生成回答。<b>不想花钱、也不想注册</b>的话，先用演示模式看看效果；
          想要真实的推理能力，选永久免费的智谱 GLM-4-Flash，或在本机跑 Ollama。
          <div class="alert-actions">
            <el-button size="small" type="primary" :loading="switching" @click="useDemo">先用演示模式看看</el-button>
            <el-button size="small" @click="openConfig">配置免费模型</el-button>
          </div>
        </div>
      </el-alert>

      <div v-else-if="isDemo" class="demo-bar">
        <el-icon class="demo-bar-icon"><InfoFilled /></el-icon>
        <div class="demo-bar-text">
          <b>演示模式</b> · 回答由本机内置的营养样例生成，用来预览输出格式与交互，<b>不是真实大模型</b>。
          想看真正的推理（任意食物、任意问法），换成永久免费的智谱 GLM-4-Flash 或本地 Ollama。
        </div>
        <el-button size="small" type="primary" plain @click="openConfig">换成免费模型</el-button>
      </div>

      <div ref="scroller" class="messages" @scroll="onScroll">
        <!-- 空态 -->
        <div v-if="!messages.length" class="welcome">
          <div class="welcome-mark">🥗</div>
          <h2>今天想了解点什么？</h2>
          <p class="welcome-sub">
            我能算食物热量、拆营养成分、解读营养价值，也会结合你的身高体重、目标体重和最近 7 天的饮食记录给建议。
          </p>
          <div class="samples">
            <button v-for="s in samples" :key="s.text" class="sample" @click="send(s.text)">
              <span class="sample-icon">{{ s.icon }}</span>
              <span class="sample-text">{{ s.text }}</span>
            </button>
          </div>
          <p class="tiny muted welcome-note">回答由模型生成，热量与营养值均为估算，不能替代医学建议。</p>
        </div>

        <!-- 消息 -->
        <div v-for="(m, idx) in messages" :key="m.id ?? `tmp-${idx}`" class="msg" :class="m.role">
          <div v-if="m.role === 'assistant'" class="avatar">AI</div>
          <div class="bubble-wrap">
            <div class="bubble" :class="{ error: m.error }">
              <template v-if="m.role === 'user'">
                <div class="user-text">{{ m.content }}</div>
              </template>
              <template v-else>
                <div v-if="m.content" class="md-body" v-html="renderMarkdown(m.content)" />
                <div v-if="m.streaming && !m.content" class="thinking">
                  <span class="dot-pulse" /><span class="dot-pulse" /><span class="dot-pulse" />
                  <span class="tiny muted">正在想…</span>
                </div>
                <div v-else-if="m.streaming" class="cursor" />
                <div v-if="m.error" class="err-text">{{ m.error }}</div>

                <!-- 助手自动记录一餐的结果卡片 -->
                <div v-if="m.action?.type === 'record_meal'" class="record-card" :class="{ fail: !m.action.result.ok }">
                  <div class="rc-head">
                    <el-icon class="rc-icon"><Check v-if="m.action.result.ok" /><Close v-else /></el-icon>
                    <div class="rc-title">
                      {{ m.action.result.ok ? `已自动记录到 ${m.action.result.date} ${m.action.result.label}` : '自动记录失败了' }}
                    </div>
                    <el-button
                      v-if="m.action.result.ok && m.action.result.ids.length"
                      size="small"
                      plain
                      type="danger"
                      :icon="RefreshLeft"
                      @click="undoRecord(m)"
                    >
                      撤销
                    </el-button>
                  </div>
                  <template v-if="m.action.result.ok">
                    <div class="rc-summary">
                      共 {{ m.action.result.count }} 项 · 合计
                      <b>{{ m.action.result.totals.kcal }} kcal</b>
                      · 蛋白 {{ m.action.result.totals.protein }}g · 碳水 {{ m.action.result.totals.carb }}g ·
                      脂肪 {{ m.action.result.totals.fat }}g · 纤维 {{ m.action.result.totals.fiber }}g
                    </div>
                    <ul class="rc-items">
                      <li v-for="(it, i) in m.action.result.items" :key="i" class="rc-item">
                        <div class="rc-it-top">
                          <span class="rc-it-name">{{ it.name }}</span>
                          <span class="rc-it-g">{{ it.grams }}g</span>
                          <span class="rc-it-k">{{ it.kcal }} kcal</span>
                        </div>
                        <div v-if="it.basis" class="rc-it-basis">估算依据：{{ it.basis }}</div>
                      </li>
                    </ul>
                    <div v-if="m.action.result.description" class="rc-note">
                      原始描述：{{ m.action.result.description }}
                    </div>
                  </template>
                  <div v-else class="rc-note">{{ m.action.result.error }}</div>
                </div>
              </template>
            </div>
            <div v-if="m.role === 'assistant' && !m.streaming && m.content" class="msg-tools">
              <button class="tool" @click="copy(m.content)">
                <el-icon><CopyDocument /></el-icon>复制
              </button>
              <button class="tool" @click="regenerate(idx)">
                <el-icon><Refresh /></el-icon>重新生成
              </button>
              <span v-if="m.model === DEMO_MODEL" class="demo-chip">演示模式 · 样例回答</span>
              <span v-else-if="m.model" class="tiny muted">{{ m.model }}</span>
            </div>
          </div>
        </div>
      </div>

      <footer class="composer">
        <div class="composer-box">
          <el-input
            v-model="draft"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 6 }"
            resize="none"
            placeholder="问点什么，或让我记录：例如「帮我把今天午餐记一下：300g米饭,100g鸡腿」（Enter 发送，Shift + Enter 换行）"
            @keydown="onKeydown"
          />
          <div class="composer-bar">
            <span class="tiny muted">
              {{ streaming ? '生成中，可点停止中断' : '回答来自模型，热量与营养值均为估算' }}
            </span>
            <el-button v-if="streaming" :icon="VideoPause" @click="stop">停止</el-button>
            <el-button v-else type="primary" :icon="Promotion" :disabled="!draft.trim()" @click="send()">发送</el-button>
          </div>
        </div>
      </footer>
    </section>

    <!-- 模型配置 -->
    <el-drawer v-model="configOpen" title="助手设置" size="500px" :close-on-click-modal="false">
      <div class="cfg">
        <div class="cfg-note">
          <b>不一定要花钱。</b>最省事的两个办法：直接选「演示模式」（零配置、零费用），
          或选「智谱 GLM-4-Flash」（永久免费，手机号注册拿 Key）。配置只存本机数据库，不会上传。
        </div>

        <div class="cfg-field">
          <label>服务商</label>
          <el-select v-model="form.provider" style="width: 100%" @change="onProviderChange">
            <el-option v-for="p in config?.presets ?? []" :key="p.id" :label="p.name" :value="p.id">
              <div class="opt">
                <span class="opt-name">{{ p.name }}</span>
                <i v-if="p.free" class="free-tag">0 元</i>
              </div>
            </el-option>
          </el-select>
        </div>

        <div v-if="currentPreset" class="preset-note" :class="{ free: currentPreset.free }">
          <div class="preset-hint">{{ currentPreset.hint }}</div>
          <div v-if="currentPreset.note" class="tiny preset-more">{{ currentPreset.note }}</div>
        </div>

        <template v-if="!isDemoMode">
          <div class="cfg-field">
            <label>接口地址</label>
            <el-input v-model="form.endpoint" placeholder="https://.../v1/chat/completions" />
            <div class="tiny muted">填到 /chat/completions 这一层，不要只填域名</div>
          </div>

          <div class="cfg-field">
            <label>模型名称</label>
            <el-select
              v-model="form.model"
              style="width: 100%"
              filterable
              allow-create
              default-first-option
              placeholder="deepseek-chat"
            >
              <el-option v-for="m in currentPresetModels" :key="m" :label="m" :value="m" />
            </el-select>
            <div v-if="!currentPresetModels.length" class="tiny muted">这个服务商需要你手填模型名</div>
          </div>

          <div class="cfg-field">
            <label>视觉模型（可选）</label>
            <el-input v-model="form.visionModel" placeholder="例如：glm-4v-flash（免费），留空则用主模型" />
            <div class="tiny muted">用于「每日饮食」的照片热量分析；填多模态模型（如智谱 glm-4v-flash，同一个 Key），留空时用主模型识别、失败自动退回纯文字分析</div>
          </div>

          <div v-if="needKey" class="cfg-field">
            <label>API Key</label>
            <el-input
              v-model="form.apiKey"
              type="password"
              show-password
              :placeholder="config?.hasKey ? `已保存 ${config.keyMasked}，留空则不变` : 'sk-...'"
            />
            <div v-if="config?.source === 'env'" class="tiny muted">
              当前使用的是环境变量 ASSISTANT_API_KEY，界面配置会被它覆盖
            </div>
            <div v-else class="tiny muted">Key 只存本机；界面上只会显示掩码</div>
          </div>
          <div v-else class="cfg-field">
            <div class="keyless-note">
              <el-icon><CircleCheck /></el-icon>
              这个方式不需要 API Key，也不会把数据发到外部
            </div>
          </div>
        </template>

        <div v-else class="cfg-field">
          <div class="keyless-note">
            <el-icon><CircleCheck /></el-icon>
            演示模式不需要地址、模型和 Key，保存后即可直接对话
          </div>
        </div>

        <div class="cfg-field">
          <label>回答风格</label>
          <el-radio-group v-model="form.tone">
            <el-radio-button value="strict">严格</el-radio-button>
            <el-radio-button value="encouraging">鼓励</el-radio-button>
            <el-radio-button value="neutral">中立</el-radio-button>
          </el-radio-group>
        </div>

        <div class="cfg-field">
          <label>随机性 {{ form.temperature.toFixed(1) }}</label>
          <el-slider v-model="form.temperature" :min="0" :max="1" :step="0.1" />
          <div class="tiny muted">营养计算建议 0.2–0.5，越低越稳定</div>
        </div>

        <div class="cfg-actions">
          <el-button :loading="testing" @click="testConn">测试连接</el-button>
          <el-button type="primary" :loading="savingCfg" @click="saveConfig">保存</el-button>
        </div>
        <div v-if="testResult" class="test-result" :class="testOk ? 'ok' : 'bad'">
          {{ testResult }}
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ChatDotRound,
  Check,
  CircleCheck,
  Close,
  CopyDocument,
  InfoFilled,
  MoreFilled,
  Plus,
  Promotion,
  Refresh,
  RefreshLeft,
  Setting,
  VideoPause,
} from '@element-plus/icons-vue'
import { api, tokenStore } from '@/api'
import { renderMarkdown } from '@/utils/markdown'
import type { AssistantConfig, AssistantMessage, AssistantThread, RecordMealResult } from '@/types/api'

interface UiMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  model?: string
  tokens?: number
  streaming?: boolean
  error?: string
  /** 助手自动记录一餐的结果卡片（仅当前会话内展示，刷新后由文字确认留存） */
  action?: { type: 'record_meal'; result: RecordMealResult }
}

const samples = [
  { icon: '🍅', text: '一个 100g 的西红柿是多少 kcal？' },
  { icon: '🥪', text: '早餐吃了两个鸡蛋、一杯无糖豆浆、一片全麦面包，大概多少热量？' },
  { icon: '🍱', text: '帮我把今天午餐记一下：300g米饭,100g鸡腿,200g西兰花' },
  { icon: '📊', text: '我今天吃得怎么样？蛋白质还差多少、晚餐该怎么补？' },
]

const config = ref<AssistantConfig | null>(null)
const threads = ref<AssistantThread[]>([])
const currentId = ref<number | null>(null)
const messages = ref<UiMessage[]>([])
const draft = ref('')
const streaming = ref(false)
const scroller = ref<HTMLElement>()
let autoScroll = true
let controller: AbortController | null = null

/** 演示模式的内置模型名，用来给消息打「样例回答」标记 */
const DEMO_MODEL = 'demo-nutrition-v1'
const isDemo = computed(() => config.value?.provider === 'demo')
const statusText = computed(() => {
  const c = config.value
  if (!c?.ready) return '未连接模型'
  if (c.provider === 'demo') return '演示模式 · 无需 Key'
  return `${c.providerName} · ${c.model}`
})

/* ------------------------------ 会话列表 ------------------------------ */

async function loadThreads() {
  threads.value = await api.assistantThreads()
}

async function newThread() {
  abortCurrent()
  currentId.value = null
  messages.value = []
  draft.value = ''
}

async function openThread(id: number) {
  if (id === currentId.value && messages.value.length) return
  abortCurrent()
  currentId.value = id
  messages.value = []
  const res = await api.assistantThread(id)
  messages.value = (res.messages as AssistantMessage[]).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    model: m.model,
  }))
  scrollToBottom(true)
}

async function onThreadCommand(cmd: string, t: AssistantThread) {
  if (cmd === 'rename') {
    try {
      const { value } = await ElMessageBox.prompt('给这个对话起个名字', '重命名', {
        inputValue: t.title,
        confirmButtonText: '保存',
        cancelButtonText: '取消',
      })
      if (!value?.trim()) return
      await api.renameAssistantThread(t.id, value.trim())
      await loadThreads()
    } catch {
      /* 取消 */
    }
    return
  }
  if (cmd === 'delete') {
    try {
      await ElMessageBox.confirm(`删除「${t.title}」？这段对话内容将不可恢复。`, '删除对话', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    await api.deleteAssistantThread(t.id)
    if (currentId.value === t.id) {
      currentId.value = null
      messages.value = []
    }
    await loadThreads()
    ElMessage.success('已删除')
  }
}

/* -------------------------------- 发送 -------------------------------- */

function abortCurrent() {
  controller?.abort()
  controller = null
  streaming.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return
  // 输入法组合中不触发
  if ((e as any).isComposing || e.keyCode === 229) return
  e.preventDefault()
  if (!streaming.value) send()
}

async function send(text?: string) {
  const content = (text ?? draft.value).trim()
  if (!content || streaming.value) return
  if (!config.value?.ready) {
    ElMessage.warning('先连接一个对话模型')
    openConfig()
    return
  }

  draft.value = ''
  messages.value.push({ role: 'user', content, id: Date.now() })
  // 用 reactive 包一层：流式增量直接改这个对象，界面才会跟着更新
  const reply = reactive<UiMessage>({ role: 'assistant', content: '', streaming: true })
  messages.value.push(reply)
  scrollToBottom(true)

  streaming.value = true
  controller = new AbortController()

  let pending = ''
  let raf = 0
  const flush = () => {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    if (pending) {
      reply.content += pending
      pending = ''
    }
  }
  const pushDelta = (t: string) => {
    pending += t
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (!pending) return
      reply.content += pending
      pending = ''
      scrollToBottom()
    })
  }

  try {
    const resp = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {}),
      },
      body: JSON.stringify({ thread_id: currentId.value, content }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      reply.error = err?.error || `请求失败（${resp.status}）`
      reply.streaming = false
      if (err?.code === 'NOT_CONFIGURED') config.value = await api.assistantConfig()
      // 裸 fetch 不经过 axios 拦截器，这里手动处理登录失效 → 跳回登录页
      if (resp.status === 401) {
        tokenStore.clear()
        tokenStore.setUser(null)
        if (location.pathname !== '/login' && location.pathname !== '/register') {
          location.href = '/login'
        }
      }
      return
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        let event = 'message'
        let data = ''
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        if (!data) continue
        let payload: any
        try {
          payload = JSON.parse(data)
        } catch {
          continue
        }

        if (event === 'meta') {
          if (payload.thread_id && !currentId.value) {
            currentId.value = payload.thread_id
            loadThreads()
          }
        } else if (event === 'delta') {
          pushDelta(payload.text ?? '')
        } else if (event === 'done') {
          flush()
          reply.model = payload.model
          reply.tokens = payload.tokens
          if (payload.message_id) reply.id = payload.message_id
        } else if (event === 'aborted') {
          flush()
          if (!reply.content.endsWith('（这里手动停止了生成）')) {
            reply.content += '\n\n> （这里手动停止了生成）'
          }
        } else if (event === 'error') {
          flush()
          reply.error = payload.error || '生成失败'
        } else if (event === 'action') {
          flush()
          reply.action = payload
          scrollToBottom()
        }
      }
    }
  } catch (err: any) {
    flush()
    if (err?.name !== 'AbortError') {
      reply.error = reply.error || err?.message || '网络异常，请重试'
    } else if (!reply.content) {
      reply.content = ''
    }
  } finally {
    flush()
    reply.streaming = false
    streaming.value = false
    controller = null
    scrollToBottom()
    if (currentId.value) loadThreads()
  }
}

function stop() {
  abortCurrent()
}

async function regenerate(idx: number) {
  // 找到这条回答之前的用户问题，删掉回答后重发
  let userIdx = -1
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (messages.value[i].role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx < 0) return
  const question = messages.value[userIdx].content
  messages.value.splice(userIdx, messages.value.length - userIdx)
  await send(question)
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

/** 撤销助手自动记录的一餐：删掉那批记录项 */
async function undoRecord(m: UiMessage) {
  const ids = m.action?.result.ids ?? []
  if (!ids.length) return
  try {
    await api.deleteDietEntries({ ids })
    ElMessage.success('已撤销自动记录')
    m.action = undefined
  } catch {
    /* 拦截器已提示 */
  }
}

/* ------------------------------- 滚动 ------------------------------- */

function onScroll() {
  const el = scroller.value
  if (!el) return
  autoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function scrollToBottom(force = false) {
  if (!force && !autoScroll) return
  nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

/* ------------------------------- 配置 ------------------------------- */

const configOpen = ref(false)
const savingCfg = ref(false)
const testing = ref(false)
const switching = ref(false)
const testResult = ref('')
const testOk = ref(false)

const form = reactive({
  provider: 'deepseek',
  endpoint: '',
  model: '',
  visionModel: '',
  apiKey: '',
  temperature: 0.4,
  tone: 'encouraging',
})

const currentPreset = computed(() => config.value?.presets.find((x) => x.id === form.provider))
const currentPresetModels = computed(() => currentPreset.value?.models ?? [])
/** 抽屉里选中了演示模式（清空表单展示） */
const isDemoMode = computed(() => form.provider === 'demo')
/** 这个方式需不需要 Key；Ollama 与演示模式都不需要 */
const needKey = computed(() => currentPreset.value?.needKey !== false)

function openConfig() {
  const c = config.value
  if (c) {
    form.provider = c.provider
    form.endpoint = c.endpoint
    form.model = c.model
    form.visionModel = c.visionModel ?? ''
    form.apiKey = ''
    form.temperature = c.temperature
    form.tone = c.tone
  }
  testResult.value = ''
  configOpen.value = true
}

function onProviderChange(id: string) {
  const p = config.value?.presets.find((x) => x.id === id)
  if (!p) return
  if (id === 'demo') {
    form.endpoint = ''
    form.model = 'demo-nutrition-v1'
    form.apiKey = ''
    return
  }
  if (p.endpoint) form.endpoint = p.endpoint
  if (p.model) form.model = p.model
}

/** 一键切到演示模式：不填任何东西就开始用 */
async function useDemo() {
  switching.value = true
  try {
    await api.saveAssistantConfig({
      provider: 'demo',
      endpoint: '',
      model: 'demo-nutrition-v1',
      apiKey: '',
      temperature: 0.4,
      tone: 'encouraging',
    })
    config.value = await api.assistantConfig()
    ElMessage.success('已切到演示模式，直接发消息就能看到效果')
  } finally {
    switching.value = false
  }
}

async function saveConfig() {
  savingCfg.value = true
  try {
    const res = await api.saveAssistantConfig({ ...form })
    config.value = await api.assistantConfig()
    if (form.provider === 'demo') {
      ElMessage.success('已切到演示模式，可以直接对话')
      configOpen.value = false
      return
    }
    ElMessage.success(res.ready ? '已保存，可以开始对话了' : `已保存，但还缺${res.missing.join('、')}`)
    if (res.ready) configOpen.value = false
  } finally {
    savingCfg.value = false
  }
}

async function testConn() {
  testing.value = true
  testResult.value = ''
  try {
    // 先保存再测，避免测的是旧配置
    await api.saveAssistantConfig({ ...form })
    config.value = await api.assistantConfig()
    const res = await api.testAssistant()
    testOk.value = Boolean(res.ok)
    testResult.value = res.ok ? `连接成功 · ${res.model} 回复：${res.reply}` : res.error || '连接失败'
  } catch (err: any) {
    testOk.value = false
    testResult.value = err?.response?.data?.error || err?.message || '连接失败'
  } finally {
    testing.value = false
  }
}

/* -------------------------------- 初始化 -------------------------------- */

onMounted(async () => {
  config.value = await api.assistantConfig()
  await loadThreads()
  if (threads.value.length) await openThread(threads.value[0].id)
})

onBeforeUnmount(() => abortCurrent())
</script>

<style scoped>
.assistant-page {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 16px;
  height: calc(100vh - 110px);
  min-height: 560px;
}

/* 左侧会话列表 */
.threads {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.threads-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--line);
}
.threads-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--ink-900);
}
.thread-scroll {
  flex: 1;
  padding: 8px;
}
.thread {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.thread:hover {
  background: #f6f8f9;
}
.thread.active {
  background: var(--brand-soft);
}
.thread-main {
  min-width: 0;
  flex: 1;
}
.thread-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thread-preview {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-400);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thread-more {
  color: var(--ink-300);
  opacity: 0;
  transition: opacity 0.15s;
}
.thread:hover .thread-more,
.thread.active .thread-more {
  opacity: 1;
}
.thread-empty {
  padding: 40px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--ink-400);
  line-height: 1.8;
}
.threads-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  background: #fbfcfc;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 7px;
}
.dot.ok {
  background: #12a37a;
}
.dot.warn {
  background: #f59e0b;
}
.dot.demo {
  background: #e0a521;
}

/* 右侧对话 */
.chat {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
}
.chat-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat-icon {
  font-size: 22px;
  color: var(--brand);
}
.chat-name {
  font-size: 14px;
  font-weight: 650;
  color: var(--ink-900);
}
.chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.no-config {
  margin: 10px 18px 0;
  width: auto;
  border-radius: 10px;
}
.alert-body {
  font-size: 12px;
  line-height: 1.7;
  margin-top: 2px;
}
.alert-actions {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}

/* 演示模式提示条 */
.demo-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 18px 0;
  padding: 9px 12px;
  border: 1px solid #f0e2bf;
  background: #fdf9ee;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: #7a5c14;
}
.demo-bar-icon {
  flex: 0 0 auto;
  font-size: 15px;
  color: #d99a17;
}
.demo-bar-text {
  flex: 1;
  min-width: 0;
}
.demo-chip {
  font-size: 11px;
  color: #b4761a;
  background: #fdf3e0;
  border: 1px solid #f0dcb4;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px 8px;
  scroll-behavior: smooth;
}

/* 空态 */
.welcome {
  max-width: 620px;
  margin: 6vh auto 0;
  text-align: center;
}
.welcome-mark {
  font-size: 40px;
}
.welcome h2 {
  margin: 10px 0 6px;
  font-size: 20px;
  color: var(--ink-900);
}
.welcome-sub {
  margin: 0 auto;
  max-width: 520px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--ink-500);
}
.samples {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 20px 0 12px;
}
.sample {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: all 0.16s;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-700);
}
.sample:hover {
  border-color: var(--brand-line);
  background: var(--brand-soft);
  transform: translateY(-1px);
}
.sample-icon {
  font-size: 15px;
  line-height: 1.4;
}
.welcome-note {
  margin-top: 10px;
}

/* 消息气泡 */
.msg {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
  align-items: flex-start;
}
.msg.user {
  flex-direction: row-reverse;
}
.avatar {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}
.bubble-wrap {
  max-width: min(760px, 86%);
  min-width: 0;
}
.msg.user .bubble-wrap {
  max-width: min(600px, 80%);
}
.bubble {
  padding: 11px 14px;
  border-radius: 14px;
  background: #f7f9fa;
  border: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.75;
  color: var(--ink-900);
  overflow-wrap: break-word;
}
.msg.user .bubble {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg.assistant .bubble {
  border-bottom-left-radius: 4px;
  background: #fff;
}
.bubble.error {
  border-color: #f3c9c9;
  background: var(--danger-soft);
}
.user-text {
  white-space: pre-wrap;
}
.err-text {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--danger);
}
.record-card {
  margin-top: 10px;
  border: 1px solid #cfeee2;
  background: #f3fbf8;
  border-radius: 10px;
  padding: 10px 12px;
}
.record-card.fail {
  border-color: #f3c9c9;
  background: var(--danger-soft);
}
.rc-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rc-icon {
  font-size: 16px;
  color: #0e8a67;
}
.record-card.fail .rc-icon {
  color: var(--danger);
}
.rc-title {
  flex: 1;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ink-900);
}
.rc-summary {
  margin-top: 7px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-700);
}
.rc-summary b {
  color: var(--brand-dark);
}
.rc-items {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rc-item {
  border: 1px solid #e2f1ea;
  background: #fff;
  border-radius: 8px;
  padding: 6px 9px;
}
.rc-it-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.rc-it-name {
  font-weight: 650;
  color: var(--ink-900);
}
.rc-it-g {
  color: var(--ink-500);
}
.rc-it-k {
  color: var(--brand-dark);
  font-weight: 600;
  margin-left: auto;
}
.rc-it-basis {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-500);
}
.rc-note {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-500);
}
.msg-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  padding-left: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.msg:hover .msg-tools {
  opacity: 1;
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: none;
  padding: 0;
  font-size: 11.5px;
  color: var(--ink-400);
  cursor: pointer;
}
.tool:hover {
  color: var(--brand);
}
.thinking {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 0;
}
.dot-pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand);
  animation: pulse 1.1s infinite ease-in-out;
}
.dot-pulse:nth-child(2) {
  animation-delay: 0.15s;
}
.dot-pulse:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes pulse {
  0%,
  70%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
.cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--brand);
  border-radius: 2px;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* 输入区 */
.composer {
  border-top: 1px solid var(--line);
  padding: 12px 18px 14px;
  background: #fcfdfd;
}
.composer-box {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 8px 10px 6px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.composer-box:focus-within {
  border-color: var(--brand-line);
  box-shadow: 0 0 0 3px rgba(18, 163, 122, 0.08);
}
.composer-box :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  padding: 4px 2px;
  font-size: 13px;
  line-height: 1.7;
}
.composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}

/* Markdown 正文 */
.md-body :deep(.md-h) {
  margin: 12px 0 6px;
  font-size: 14px;
  font-weight: 650;
  color: var(--ink-900);
}
.md-body :deep(.md-h:first-child) {
  margin-top: 2px;
}
.md-body :deep(p) {
  margin: 6px 0;
}
.md-body :deep(.md-list) {
  margin: 6px 0;
  padding-left: 20px;
}
.md-body :deep(.md-list li) {
  margin: 3px 0;
}
.md-body :deep(code) {
  background: #eef2f4;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12px;
  font-family: 'SF Mono', Menlo, monospace;
}
.md-body :deep(.md-pre) {
  background: #0e1b17;
  color: #dfe9e4;
  padding: 12px;
  border-radius: 10px;
  overflow-x: auto;
  margin: 8px 0;
}
.md-body :deep(.md-pre code) {
  background: none;
  color: inherit;
  padding: 0;
}
.md-body :deep(.md-table-wrap) {
  overflow-x: auto;
  margin: 8px 0;
}
.md-body :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.md-body :deep(.md-table th) {
  background: #f4f7f8;
  font-weight: 650;
  text-align: left;
  padding: 7px 10px;
  border: 1px solid var(--line);
  white-space: nowrap;
}
.md-body :deep(.md-table td) {
  padding: 6px 10px;
  border: 1px solid var(--line);
}
.md-body :deep(.md-table tbody tr:nth-child(even)) {
  background: #fbfcfc;
}
.md-body :deep(.md-quote) {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--brand-line);
  background: var(--brand-soft);
  border-radius: 0 8px 8px 0;
  color: var(--ink-700);
  font-size: 12.5px;
}
.md-body :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--line);
  margin: 12px 0;
}
.md-body :deep(a) {
  color: var(--brand-dark);
  text-decoration: underline;
}

/* 配置抽屉 */
.cfg {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cfg-note {
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-500);
  background: #f7f9fa;
  border-radius: 10px;
  padding: 10px 12px;
}
.cfg-note code {
  background: #eef2f4;
  padding: 1px 4px;
  border-radius: 4px;
}
.cfg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cfg-field label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-700);
}
.opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.opt-name {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.free-tag {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 600;
  color: #0e8a67;
  background: #e6f6f0;
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 6px;
  flex: 0 0 auto;
}

/* 选中预设后的说明 */
.preset-note {
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-500);
  background: #f7f9fa;
  border-radius: 10px;
  padding: 9px 12px;
  border-left: 3px solid var(--line);
}
.preset-note.free {
  background: #f2fbf7;
  border-left-color: var(--brand);
}
.preset-hint {
  font-weight: 600;
  color: var(--ink-900);
}
.preset-more {
  margin-top: 4px;
  color: var(--ink-500);
}
.keyless-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #0e8a67;
  background: #f0faf6;
  border: 1px solid #cfeee2;
  border-radius: 8px;
  padding: 8px 10px;
}
.cfg-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
.cfg-actions .el-button {
  flex: 1;
}
.test-result {
  font-size: 12px;
  line-height: 1.7;
  border-radius: 8px;
  padding: 8px 10px;
}
.test-result.ok {
  background: var(--brand-soft);
  color: var(--brand-dark);
}
.test-result.bad {
  background: var(--danger-soft);
  color: var(--danger);
}

@media (max-width: 1080px) {
  .assistant-page {
    grid-template-columns: 1fr;
    height: auto;
  }
  .threads {
    display: none;
  }
}
</style>
