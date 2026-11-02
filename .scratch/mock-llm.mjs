/**
 * 本地 mock：模拟 OpenAI 兼容的 /v1/chat/completions（流式）
 * 只用于本地验证「我的助手」链路，不参与生产。
 */
import http from 'node:http'

const ANSWER = `### 1. 热量与估算依据

按中等大小、生食、未加油估算：

| 项目 | 数值 |
| --- | --- |
| 可食部重量 | 约 150 g |
| 基准热量 | 18 kcal/100 g |
| 估算总热量 | **约 27 kcal** |

计算式：18 kcal/100 g × 1.5 = 27 kcal。若你指的是正好 100 g 可食部，则为 **约 18 kcal**；炒制加 5 g 油则再加约 45 kcal（合计约 63 kcal）。

### 2. 主要营养成分与营养价值

| 营养素 | 含量（150 g） | 占每日参考摄入 | 在这份食物里的作用 |
| --- | --- | --- | --- |
| 碳水化合物 | 5.8 g | 约 2% | 主要是葡萄糖与果糖，供能温和 |
| 膳食纤维 | 1.8 g | 约 7% | 促进肠道蠕动，增加饱腹感 |
| 蛋白质 | 1.4 g | 约 2% | 含量低，不能作为蛋白来源 |
| 维生素 C | 21 mg | 约 23% | 抗氧化，促进胶原合成与铁吸收 |
| 番茄红素 | 约 4 mg | — | 脂溶性类胡萝卜素，加热+少量油后吸收率更高 |
| 钾 | 270 mg | 约 13% | 帮助调节体液平衡与血压 |

### 3. 营养特点与注意事项

- **热量密度极低**：约 18 kcal/100 g，是减脂期最安全的"占体积"食材之一，吃 300 g 也只有 50 多 kcal。
- **饱腹感来源是水分和纤维**，不是蛋白或脂肪，所以别指望它顶饿。
- **生吃 vs 熟吃**：维生素 C 生吃保留更好；番茄红素熟吃（尤其配 3–5 g 油）吸收率明显提高，两者不冲突，可以交替。
- **注意人群**：胃食管反流、胃酸过多者空腹大量生吃可能不适；肾功能不全需限钾者要计入钾总量。
- 常见误区：不存在"负卡路里食物"，西红柿只是热量低，不是吃了能倒扣热量。

### 4. 结合你目标的建议

你现在 62.5 kg、目标 55 kg，日均总消耗约 1700 kcal，缺口控制在 400–450 kcal 比较稳。

1. **午餐加一份 200 g 西红柿**（约 36 kcal），替代现在的部分白米饭（减 50 g 熟饭约省 58 kcal），体积更大、更抗饿。
2. **下午加餐**如果想吃东西，用 200 g 西红柿 + 100 g 无糖酸奶（约 100 kcal 合计），比饼干（3 片约 150 kcal）更划算。
3. **炒西红柿时控油**：用不粘锅、喷油壶，把油从 10 g 降到 5 g，一次就省 45 kcal，一周 5 次约 225 kcal。
4. 别用"番茄酱"替代西红柿：市售番茄酱每 100 g 常含 15–20 g 糖，热量是鲜番茄的 5–6 倍。

> 以上热量与营养值为估算值，依据中国食物成分表常见量级；实际品种、成熟度、产地会有 10%–20% 波动。`

const server = http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      /* ignore */
    }
    const messages = payload.messages ?? []
    const isTest = JSON.stringify(messages).includes('连通性测试')
    const text = isTest ? '可以' : ANSWER
    const model = payload.model || 'mock-nutrition'

    console.log(`[mock] model=${model} msgs=${messages.length} stream=${payload.stream} test=${isTest}`)

    if (!payload.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model,
          choices: [{ message: { role: 'assistant', content: text } }],
          usage: { total_tokens: 800 },
        }),
      )
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(`data: ${JSON.stringify({ model, choices: [{ delta: { role: 'assistant' } }] })}\n\n`)

    const chunks = text.match(/[\s\S]{1,12}/g) ?? []
    let i = 0
    const timer = setInterval(() => {
      if (i >= chunks.length) {
        clearInterval(timer)
        res.write(`data: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 800 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content: chunks[i] } }] })}\n\n`)
      i += 1
    }, 18)

    // 客户端断开才停；注意不能用 req.on('close')，请求体读完就会触发
    res.on('close', () => {
      if (!res.writableEnded) clearInterval(timer)
    })
  })
})

server.listen(4399, () => console.log('mock llm on http://127.0.0.1:4399/v1/chat/completions'))
