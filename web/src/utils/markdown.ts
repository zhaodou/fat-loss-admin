/**
 * 轻量 Markdown 渲染（助手回答专用）
 * ---------------------------------------------------------------------------
 * 不引第三方库，只覆盖模型实际会输出的语法：
 *   标题 / 表格 / 有序与无序列表 / 引用 / 代码块 / 行内代码 / 粗体 / 斜体 / 链接 / 分隔线
 *
 * 安全策略：**先整体转义 HTML，再做 Markdown 替换**。
 * 模型回复是不可信输入，这样即使它吐出 <script> 也只会被当成文字显示。
 */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text: string): string {
  let out = text
  // 行内代码优先，避免里面的星号被当成加粗
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
  return out
}

/** 判断是否是表格分隔行：| --- | :--: | */
const isDivider = (line: string): boolean => /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes('-')

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function renderMarkdown(source: string): string {
  if (!source) return ''

  const normalized = source.replace(/\r\n?/g, '\n')

  /* 1. 先把代码块抽出来，避免里面的符号被解析 */
  const blocks: string[] = []
  const withoutCode = normalized.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const idx = blocks.length
    blocks.push(`<pre class="md-pre"><code data-lang="${escapeHtml(lang || '')}">${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)
    return `\u0000BLOCK${idx}\u0000`
  })

  /* 2. 整体转义 */
  const escaped = escapeHtml(withoutCode)
  const lines = escaped.split('\n')

  const html: string[] = []
  let i = 0

  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return
    html.push(`<p>${inline(buf.join('<br>'))}</p>`)
    buf.length = 0
  }
  const para: string[] = []

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    /* 空行 */
    if (!trimmed) {
      flushParagraph(para)
      i += 1
      continue
    }

    /* 代码块占位 */
    const blockMatch = trimmed.match(/^\u0000BLOCK(\d+)\u0000$/)
    if (blockMatch) {
      flushParagraph(para)
      html.push(blocks[Number(blockMatch[1])] ?? '')
      i += 1
      continue
    }

    /* 表格：当前行含 |，下一行是分隔行 */
    if (trimmed.includes('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flushParagraph(para)
      const head = splitRow(trimmed)
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        body.push(splitRow(lines[i]))
        i += 1
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${body
        .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
      html.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`)
      continue
    }

    /* 标题 */
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph(para)
      const level = Math.min(6, heading[1].length + 2) // # 也至少渲染成 h3，避免过大
      html.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`)
      i += 1
      continue
    }

    /* 分隔线 */
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(para)
      html.push('<hr class="md-hr" />')
      i += 1
      continue
    }

    /* 引用 */
    if (trimmed.startsWith('&gt;')) {
      flushParagraph(para)
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('&gt;')) {
        quote.push(lines[i].trim().replace(/^&gt;\s?/, ''))
        i += 1
      }
      html.push(`<blockquote class="md-quote">${inline(quote.join('<br>'))}</blockquote>`)
      continue
    }

    /* 无序列表 */
    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph(para)
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''))
        i += 1
      }
      html.push(`<ul class="md-list">${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`)
      continue
    }

    /* 有序列表 */
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph(para)
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''))
        i += 1
      }
      html.push(`<ol class="md-list">${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`)
      continue
    }

    para.push(trimmed)
    i += 1
  }

  flushParagraph(para)
  return html.join('')
}
