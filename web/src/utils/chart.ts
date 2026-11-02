/** ECharts 公共主题片段，保证所有图表视觉一致 */
export const palette = ['#12a37a', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b']

export function axisStyle() {
  return {
    axisLine: { lineStyle: { color: '#e6ebee' } },
    axisTick: { show: false },
    axisLabel: { color: '#8f99a6', fontSize: 11 },
    splitLine: { lineStyle: { color: '#f2f5f7', type: 'dashed' as const } },
  }
}

export function tooltipStyle() {
  return {
    trigger: 'axis' as const,
    backgroundColor: 'rgba(19,26,34,0.92)',
    borderWidth: 0,
    padding: [8, 12],
    textStyle: { color: '#fff', fontSize: 12 },
    axisPointer: { type: 'line' as const, lineStyle: { color: '#c9ece0' } },
  }
}

export function gridStyle(extra: Record<string, unknown> = {}) {
  return { left: 8, right: 14, top: 24, bottom: 6, containLabel: true, ...extra }
}

/** 给数字加千分位，图表 tooltip 用 */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}
