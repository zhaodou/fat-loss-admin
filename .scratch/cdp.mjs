/**
 * 临时 CDP 脚本：打开每日饮食页 → 点开午餐「+」→ 点「按食材组合」→ 截图
 * 用 Node 22 内置 WebSocket，不依赖 puppeteer。
 */
import fs from 'node:fs'

const PORT = process.argv[2] || '9333'
const OUT = process.argv[3] || 'shots/composer.png'

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
  if (res?.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(res.exceptionDetails).slice(0, 300))
  return res?.result?.value
}

await new Promise((r) => setTimeout(r, 2500))

// 1. 点午餐卡片的 + 按钮（第 2 个 .meal-head-right 里的 primary 圆按钮）
await evalJs(`
  (() => {
    const meals = [...document.querySelectorAll('.meal-head')]
    const lunch = meals.find(m => m.textContent.includes('午餐'))
    const btn = lunch?.querySelector('.meal-head-right .el-button--primary')
    btn?.click()
    return !!btn
  })()
`)
await new Promise((r) => setTimeout(r, 900))

// 2. 点「按食材组合」链接按钮
await evalJs(`
  (() => {
    const links = [...document.querySelectorAll('.el-dialog .el-button--primary.is-link, .el-dialog .el-button.is-link')]
    const target = links.find(b => b.textContent.includes('按食材组合'))
    target?.click()
    return target?.textContent?.trim() ?? 'NOT_FOUND'
  })()
`)
await new Promise((r) => setTimeout(r, 1400))

// 3. 截图
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log('saved', OUT, fs.statSync(OUT).size, 'bytes')

ws.close()
process.exit(0)
