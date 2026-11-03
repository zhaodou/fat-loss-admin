/**
 * 「我的助手」接口
 * ---------------------------------------------------------------------------
 * - 配置：读写模型连接（API Key 只回传掩码，避免明文出现在前端状态里）
 * - 会话：threads / messages 持久化，刷新页面不丢
 * - 对话：POST /assistant/chat 走 SSE 流式，边生成边返回
 */
import { Router } from 'express'
import { LLM_PRESETS, type AssistantSettings } from '../config'
import { db, getSettings, nowIso, saveSettings } from '../db'
import {
  LlmError,
  maskKey,
  resolveLlm,
  streamChat,
  systemPrompt,
  trimHistory,
  RECORD_MEAL_TOOL,
  executeRecordMeal,
  parseRecordIntent,
  extractItemsFromReply,
  buildRecordConfirmation,
  type ChatMessage,
} from '../services/assistant'
import { asyncRoute, num, optionalNum, str } from './helpers'

export const assistantRouter = Router()

/* -------------------------------- 配置 -------------------------------- */

assistantRouter.get('/assistant/config', (_req, res) => {
  const cfg = resolveLlm()
  const ai = getSettings().ai
  res.json({
    provider: cfg.provider,
    providerName: cfg.providerName,
    model: cfg.model,
    endpoint: cfg.endpoint,
    temperature: cfg.temperature,
    tone: cfg.tone,
    hasKey: Boolean(cfg.apiKey),
    keyMasked: maskKey(cfg.apiKey),
    source: cfg.source,
    ready: cfg.ready,
    missing: cfg.missing,
    visionModel: getSettings().ai.visionModel ?? '',
    presets: LLM_PRESETS,
  })
})

assistantRouter.put(
  '/assistant/config',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const current = getSettings().ai
    const provider = str(b.provider, current.provider)
    const preset = LLM_PRESETS.find((p) => p.id === provider)

    // 前端拿到的是掩码，原样回传时不要覆盖真实 Key
    let apiKey = current.apiKey
    if (typeof b.apiKey === 'string') {
      const incoming = b.apiKey.trim()
      if (incoming === '' ) apiKey = ''
      else if (!incoming.includes('••••')) apiKey = incoming
    }

    const isDemo = provider === 'demo'
    const next: AssistantSettings = {
      provider,
      model: isDemo ? 'demo-nutrition-v1' : str(b.model, preset?.model || current.model),
      endpoint: isDemo ? '' : str(b.endpoint, preset?.endpoint || current.endpoint),
      apiKey,
      temperature: Math.min(1.5, Math.max(0, num(b.temperature, current.temperature ?? 0.4))),
      tone: ['strict', 'encouraging', 'neutral'].includes(str(b.tone)) ? (b.tone as AssistantSettings['tone']) : current.tone,
      // 视觉模型：AI 饮食热量分析用，可留空（留空则用主模型尝试，失败降级纯文字）
      visionModel: isDemo ? '' : str(b.visionModel, current.visionModel ?? '').trim(),
    }
    saveSettings({ ai: next })
    const cfg = resolveLlm()
    res.json({ ok: true, ready: cfg.ready, missing: cfg.missing, keyMasked: maskKey(cfg.apiKey), hasKey: Boolean(cfg.apiKey) })
  }),
)

/** 连通性测试：发一句最短的话，验证地址 / Key / 模型名是否都对 */
assistantRouter.post(
  '/assistant/test',
  asyncRoute(async (_req, res) => {
    const cfg = resolveLlm()
    if (cfg.provider === 'demo') {
      res.json({ ok: true, model: 'demo-nutrition-v1', reply: '演示模式已就绪（不走网络，无需 Key）' })
      return
    }
    if (!cfg.ready) {
      res.status(400).json({ ok: false, error: `缺少${cfg.missing.join('、')}`, missing: cfg.missing })
      return
    }
    try {
      let received = ''
      const out = await streamChat({
        messages: [
          { role: 'system', content: '只回复两个字：可以' },
          { role: 'user', content: '连通性测试' },
        ],
        onDelta: (t) => {
          received += t
        },
      })
      res.json({ ok: true, model: out.model, reply: received.slice(0, 40) || out.content.slice(0, 40) })
    } catch (err) {
      const message = err instanceof LlmError ? err.message : err instanceof Error ? err.message : String(err)
      res.status(400).json({ ok: false, error: message })
    }
  }),
)

/* -------------------------------- 会话 -------------------------------- */

interface ThreadRow {
  id: number
  title: string
  created_at: string
  updated_at: string
}

assistantRouter.get('/assistant/threads', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM assistant_messages m WHERE m.thread_id = t.id) AS message_count,
              (SELECT content FROM assistant_messages m WHERE m.thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_content
       FROM assistant_threads t ORDER BY t.updated_at DESC`,
    )
    .all() as (ThreadRow & { message_count: number; last_content: string | null })[]
  res.json(
    rows.map((r) => ({
      ...r,
      preview: (r.last_content ?? '').replace(/[#>*`\n]/g, ' ').trim().slice(0, 60),
    })),
  )
})

assistantRouter.post(
  '/assistant/threads',
  asyncRoute((req, res) => {
    const now = nowIso()
    const info = db
      .prepare(`INSERT INTO assistant_threads (title, created_at, updated_at) VALUES (?, ?, ?)`)
      .run(str(req.body?.title, '新的对话').slice(0, 60) || '新的对话', now, now)
    const id = Number(info.lastInsertRowid)
    res.json({ ok: true, id, thread: db.prepare('SELECT * FROM assistant_threads WHERE id = ?').get(id) })
  }),
)

assistantRouter.get(
  '/assistant/threads/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const thread = db.prepare('SELECT * FROM assistant_threads WHERE id = ?').get(id) as ThreadRow | undefined
    if (!thread) throw new Error('会话不存在')
    const messages = db
      .prepare('SELECT id, role, content, model, tokens, created_at FROM assistant_messages WHERE thread_id = ? ORDER BY id')
      .all(id)
    res.json({ thread, messages })
  }),
)

assistantRouter.patch(
  '/assistant/threads/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    const title = str(req.body?.title).trim()
    if (!title) throw new Error('标题不能为空')
    db.prepare('UPDATE assistant_threads SET title = ?, updated_at = ? WHERE id = ?').run(title.slice(0, 60), nowIso(), id)
    res.json({ ok: true })
  }),
)

assistantRouter.delete(
  '/assistant/threads/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id)
    db.transaction(() => {
      db.prepare('DELETE FROM assistant_messages WHERE thread_id = ?').run(id)
      db.prepare('DELETE FROM assistant_threads WHERE id = ?').run(id)
    })()
    res.json({ ok: true })
  }),
)

/* -------------------------------- 对话 -------------------------------- */

function titleFrom(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim()
  return line.length > 24 ? `${line.slice(0, 24)}…` : line || '新的对话'
}

assistantRouter.post('/assistant/chat', (req, res) => {
  const content = str(req.body?.content).trim()
  if (!content) {
    res.status(400).json({ ok: false, error: '消息内容不能为空' })
    return
  }

  const cfg = resolveLlm()
  if (!cfg.ready) {
    res.status(400).json({
      ok: false,
      code: 'NOT_CONFIGURED',
      error: `还没有连接模型：缺少${cfg.missing.join('、')}。点右上角「助手设置」填好后就能对话。`,
      missing: cfg.missing,
    })
    return
  }

  /* 先把系统提示词拼好（会查档案/记录，可能出错），再落库，避免留下没回答的孤儿消息 */
  let sys = ''
  try {
    sys = systemPrompt()
  } catch (err) {
    res.status(500).json({ ok: false, error: `读取你的档案失败：${err instanceof Error ? err.message : String(err)}` })
    return
  }

  /* 准备会话与历史 */
  const now = nowIso()
  let threadId = optionalNum(req.body?.thread_id)
  if (threadId) {
    const exists = db.prepare('SELECT id FROM assistant_threads WHERE id = ?').get(threadId)
    if (!exists) threadId = null
  }
  if (!threadId) {
    const info = db
      .prepare('INSERT INTO assistant_threads (title, created_at, updated_at) VALUES (?, ?, ?)')
      .run(titleFrom(content), now, now)
    threadId = Number(info.lastInsertRowid)
  }

  const insertMsg = db.prepare(
    `INSERT INTO assistant_messages (thread_id, role, content, model, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const userMsgId = Number(insertMsg.run(threadId, 'user', content, '', 0, now).lastInsertRowid)

  const history = db
    .prepare('SELECT role, content FROM assistant_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 24')
    .all(threadId) as { role: string; content: string }[]

  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    ...trimHistory(
      history
        .reverse()
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ),
  ]

  /* SSE 头 */
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  send('meta', { thread_id: threadId, user_message_id: userMsgId, model: cfg.model })

  /* 上一条用户消息：演示模式下用它来识别「把这一餐记到…」意图时取食物描述 */
  const userContents = history.filter((m) => m.role === 'user').map((m) => m.content)
  const prevUserText = userContents[1] ?? ''

  const controller = new AbortController()
  let aborted = false
  let partial = ''
  res.on('close', () => {
    if (!res.writableEnded) {
      aborted = true
      controller.abort()
    }
  })

  /** 统一的增量回调：累计 + 推流 */
  const onDelta = (text: string) => {
    partial += text
    send('delta', { text })
  }

  /** 真实模型两轮流程：首轮可能发起 record_meal 工具调用，执行后让模型确认 */
  async function generate(): Promise<{ content: string; model: string; tokens: number }> {
    if (cfg.provider === 'demo') {
      const intent = parseRecordIntent(content, prevUserText)
      if (intent) {
        try {
          const rec = await executeRecordMeal(intent.date, intent.mealType, intent.description)
          send('action', { type: 'record_meal', result: rec })
          const confirmation = buildRecordConfirmation(rec)
          onDelta(confirmation)
          return { content: confirmation, model: cfg.model, tokens: 0 }
        } catch {
          /* 记录失败，降级成普通对话 */
        }
      }
      const out = await streamChat({ messages, signal: controller.signal, onDelta })
      return { content: out.content, model: out.model, tokens: out.tokens }
    }

    const out1 = await streamChat({ messages, tools: [RECORD_MEAL_TOOL], signal: controller.signal, onDelta })
    const call = (out1.toolCalls ?? []).find((t) => t.function?.name === 'record_meal')
    if (!call) {
      // 兜底：模型没调工具，但文字上说了"已记录/已保存" → 自动从它本轮回复里提取算好的数值落库，
      // 保证「说了记录就真落库」，且按对话里给出的数据记录，不二次估算。
      let fallback: Awaited<ReturnType<typeof executeRecordMeal>> | null = null
      try {
        const saidRecorded = /(已?记录成功|已保存|已?帮你?记录|已记到|记到.{0,12}(中|里)|已?经?记录|已存入|保存成功|记录好了|已经记好|已添加到|已帮你存)/.test(
          out1.content || '',
        )
        if (saidRecorded) {
          const intent = parseRecordIntent(content, prevUserText)
          if (intent) {
            const extracted = extractItemsFromReply(out1.content || '')
            fallback = await executeRecordMeal(
              intent.date,
              intent.mealType,
              intent.description,
              extracted.length ? extracted : undefined,
            )
            send('action', { type: 'record_meal', result: fallback, autoFallback: true })
          }
        }
      } catch {
        /* 兜底失败不阻断正常对话 */
      }
      return { content: out1.content || '', model: out1.model, tokens: out1.tokens }
    }

    // 执行工具：把这一餐记到指定日期/餐次
    let rec: Awaited<ReturnType<typeof executeRecordMeal>> | { ok: false; error: string }
    try {
      const args = JSON.parse(call.function.arguments || '{}')
      // 重要：把助手已经算好的结构化 items 透传下去，保证「记录的就是对话里给出的数据」，不再二次估算
      const items = Array.isArray(args.items)
        ? (args.items as any[])
            .map((x) => ({
              name: String(x?.name ?? '').trim(),
              grams: Number(x?.grams) || 0,
              kcal: Number(x?.kcal) || 0,
              protein: Number(x?.protein) || 0,
              fat: Number(x?.fat) || 0,
              carb: Number(x?.carb) || 0,
              fiber: Number(x?.fiber) || 0,
              basis: String(x?.basis ?? '').trim(),
            }))
            .filter((x) => x.name)
        : undefined
      rec = await executeRecordMeal(args.date, args.meal_type, args.description, items)
      send('action', { type: 'record_meal', result: rec })
    } catch (err) {
      rec = { ok: false, error: err instanceof Error ? err.message : String(err) }
      send('action', { type: 'record_meal', result: rec })
    }

    // 第二轮：让模型用一句话自然确认（关闭工具，避免再次调用）
    const follow: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: out1.content || '（已为你调用记录功能）' },
      { role: 'user', content: toolFollowPrompt(rec) },
    ]
    const out2 = await streamChat({ messages: follow, toolChoice: 'none', signal: controller.signal, onDelta })
    return { content: out2.content, model: out2.model, tokens: out2.tokens }
  }

  /** 构造第二轮提示：把工具执行结果告诉模型，让它自然确认 */
  function toolFollowPrompt(rec: { ok: boolean; error?: string; date?: string; label?: string; count?: number; totals?: Record<string, number> }): string {
    if (rec?.ok) {
      const t = rec.totals ?? {}
      return (
        `（系统提示：你刚刚调用了 record_meal 工具，已把这一餐保存到「每日饮食」——` +
        `日期 ${rec.date} ${rec.label}，共 ${rec.count} 项，合计 ${t.kcal ?? 0} kcal` +
        `（蛋白 ${t.protein ?? 0} g / 碳水 ${t.carb ?? 0} g / 脂肪 ${t.fat ?? 0} g / 纤维 ${t.fiber ?? 0} g）。` +
        `请用一句话自然地向用户确认「已记录成功」，并提醒可以到「每日饮食」里查看、整体编辑或重新计算。` +
        `不要重复列全部明细，也不要再调用任何工具。）`
      )
    }
    return `（系统提示：你尝试调用 record_meal 记录这一餐，但执行失败了：${rec?.error ?? '未知错误'}。请向用户说明记录没成功，并建议他用「每日饮食」里的描述→计算功能手动记录。）`
  }

  generate()
    .then((out) => {
      const finalContent = partial.trim() ? partial : out.content
      const msgId = Number(
        insertMsg.run(threadId, 'assistant', finalContent, out.model, out.tokens, nowIso()).lastInsertRowid,
      )
      db.prepare('UPDATE assistant_threads SET updated_at = ? WHERE id = ?').run(nowIso(), threadId)
      // 首轮自动用问题当标题，避免一堆「新的对话」
      const thread = db.prepare('SELECT title FROM assistant_threads WHERE id = ?').get(threadId) as { title: string }
      if (thread && (thread.title === '新的对话' || !thread.title)) {
        db.prepare('UPDATE assistant_threads SET title = ? WHERE id = ?').run(titleFrom(content), threadId)
      }
      send('done', { message_id: msgId, model: out.model, tokens: out.tokens, thread_id: threadId })
      res.end()
    })
    .catch((err) => {
      const abortedErr = (err as Error)?.name === 'AbortError' || aborted
      if (abortedErr) {
        // 用户主动停止：把已经生成的部分存下来，不当作错误
        if (partial.trim()) {
          insertMsg.run(threadId, 'assistant', `${partial}\n\n> （这里手动停止了生成）`, cfg.model, 0, nowIso())
        }
        db.prepare('UPDATE assistant_threads SET updated_at = ? WHERE id = ?').run(nowIso(), threadId)
        send('aborted', { ok: true, thread_id: threadId })
        res.end()
        return
      }
      const message = err instanceof LlmError ? err.message : err instanceof Error ? err.message : String(err)
      console.error('[assistant]', message)
      send('error', { error: message, thread_id: threadId, user_message_id: userMsgId })
      res.end()
    })
})

/* 供其它路由复用：清空助手数据时用 */
export function clearAssistant(): void {
  db.transaction(() => {
    db.prepare('DELETE FROM assistant_messages').run()
    db.prepare('DELETE FROM assistant_threads').run()
  })()
}
