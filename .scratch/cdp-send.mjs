const PORT = process.argv[2] || '9345'
const OUT = process.argv[3] || 'shots/assistant-stream.png'
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
  if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400))
  return res?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(3000)
console.log('new thread:', await evalJs(`document.querySelector('.threads-head .el-button')?.click(); 'ok'`))
await sleep(600)
console.log('welcome visible:', await evalJs(`Boolean(document.querySelector('.welcome'))`))
console.log('click sample:', await evalJs(`document.querySelector('.sample')?.click(); 'ok'`))
await sleep(1500)
console.log('mid-stream bubbles:', await evalJs(`document.querySelectorAll('.msg').length`))
await sleep(6000)
console.log('final bubbles:', await evalJs(`document.querySelectorAll('.msg').length`))
console.log('last msg len:', await evalJs(`[...document.querySelectorAll('.bubble')].pop()?.textContent.length`))
const s = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync(OUT, Buffer.from(s.data, 'base64'))
console.log('saved', OUT)
ws.close()
process.exit(0)
