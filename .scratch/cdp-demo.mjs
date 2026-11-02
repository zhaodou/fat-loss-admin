const PORT = process.argv[2] || '9351'
const OUT_CHAT = process.argv[3] || 'shots/demo-chat.png'
const OUT_CFG = process.argv[4] || 'shots/demo-config.png'

async function getWsUrl() {
  for (let i = 0; i < 24; i++) {
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
  if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300))
  return res?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { writeFileSync } = await import('node:fs')
async function shot(path) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path, Buffer.from(s.data, 'base64'))
  console.log('saved', path)
}

await sleep(3000)

/* 1. 状态检查 */
console.log('demo-bar:', await evalJs(`document.querySelector('.demo-bar') ? 'yes' : 'no'`))
console.log('tag:', await evalJs(`document.querySelector('.chat-actions .el-tag')?.textContent?.trim()`))
console.log('status:', await evalJs(`document.querySelector('.threads-foot .tiny')?.textContent?.trim()`))

/* 2. 点第一个示例问题 */
console.log('click:', await evalJs(`document.querySelector('.sample')?.click(); 'ok'`))
await sleep(2000)
console.log('mid bubbles:', await evalJs(`document.querySelectorAll('.msg').length`))
await sleep(14000)
console.log('final bubbles:', await evalJs(`document.querySelectorAll('.msg').length`))
console.log('answer len:', await evalJs(`[...document.querySelectorAll('.bubble')].pop()?.textContent?.length`))
console.log('tables:', await evalJs(`document.querySelectorAll('.md-table').length`))
console.log('demo chip:', await evalJs(`document.querySelector('.demo-chip')?.textContent?.trim()`))
await evalJs(`document.querySelector('.messages').scrollTop = 0`)
await sleep(600)
await shot(OUT_CHAT)

/* 3. 打开设置抽屉 */
await evalJs(`[...document.querySelectorAll('.chat-actions .el-button')].pop()?.click()`)
await sleep(1200)
console.log('drawer open:', await evalJs(`document.querySelector('.el-drawer') ? 'yes' : 'no'`))
console.log('keyless note:', await evalJs(`document.querySelector('.keyless-note')?.textContent?.trim()?.slice(0,40)`))
console.log('preset note:', await evalJs(`document.querySelector('.preset-hint')?.textContent?.trim()`))
console.log('free tags:', await evalJs(`document.querySelectorAll('.free-tag').length`))
await shot(OUT_CFG)

ws.close()
process.exit(0)
