/**
 * 临时 CDP 脚本：验证「我的助手」两个交互态
 *   1. 助手设置抽屉
 *   2. 空态欢迎页（点 + 新建对话）
 */
const PORT = process.argv[2] || '9344'
const OUT1 = process.argv[3] || 'shots/assistant-config.png'
const OUT2 = process.argv[4] || 'shots/assistant-welcome.png'

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP not reachable')
}

const ws = new WebSocket(await getWsUrl())
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
await new Promise((r) => (ws.onopen = r))

async function evalJs(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res?.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(res.exceptionDetails).slice(0, 400))
  return res?.result?.value
}
async function shot(out) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, Buffer.from(s.data, 'base64'))
  console.log('saved', out)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await sleep(3000)

/* 1. 打开助手设置抽屉 */
const r1 = await evalJs(`
  (() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('助手设置'))
    if (!btn) return 'no-btn'
    btn.click()
    return 'ok'
  })()
`)
console.log('open config:', r1)
await sleep(1200)
await shot(OUT1)

/* 2. 关闭抽屉，新建对话看空态 */
await evalJs(`document.querySelector('.el-drawer__close-btn')?.click(); 'ok'`)
await sleep(600)
const r2 = await evalJs(`
  (() => {
    const btn = document.querySelector('.threads-head .el-button')
    if (!btn) return 'no-plus'
    btn.click()
    return 'ok'
  })()
`)
console.log('new thread:', r2)
await sleep(800)
await shot(OUT2)

ws.close()
process.exit(0)
