/** E2E：打开组合弹窗 → 点「自制三明治」模板 → 截图 → 点「加入午餐」 */
import fs from 'node:fs'

const PORT = process.argv[2] || '9333'
const OUT = process.argv[3] || 'shots/composer-filled.png'
const CLICK_LOG = process.argv[4] !== 'nolog'

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2500)

// 打开午餐 +
await evalJs(`
  (() => {
    const lunch = [...document.querySelectorAll('.meal-head')].find(m => m.textContent.includes('午餐'))
    lunch?.querySelector('.meal-head-right .el-button--primary')?.click()
    return 'opened'
  })()
`)
await sleep(900)

// 点「按食材组合」
await evalJs(`
  (() => {
    const target = [...document.querySelectorAll('.el-dialog .el-button.is-link')]
      .find(b => b.textContent.includes('按食材组合'))
    target?.click()
    return 'composer'
  })()
`)
await sleep(1500)

// 点「自制三明治」模板
const tpl = await evalJs(`
  (() => {
    const chip = [...document.querySelectorAll('.tpl-chip')].find(c => c.textContent.includes('自制三明治'))
    chip?.click()
    return chip ? chip.textContent.trim() : 'TPL_NOT_FOUND'
  })()
`)
console.log('template:', tpl)
await sleep(1200)

const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log('saved', OUT, fs.statSync(OUT).size, 'bytes')

if (!CLICK_LOG) {
  ws.close()
  process.exit(0)
}

// 点「加入午餐」完成 E2E
const log = await evalJs(`
  (() => {
    const btns = [...document.querySelectorAll('.el-dialog .el-button--primary')]
    const btn = btns.find(b => b.textContent.includes('加入午餐'))
    btn?.click()
    return btn ? 'clicked' : 'BTN_NOT_FOUND'
  })()
`)
console.log('log button:', log)
await sleep(1600)

const toast = await evalJs(`document.querySelector('.el-message')?.textContent?.trim() ?? 'no toast'`)
console.log('toast:', toast)

ws.close()
process.exit(0)
