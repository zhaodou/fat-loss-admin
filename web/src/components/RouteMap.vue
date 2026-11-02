<template>
  <div class="route">
    <div class="route-canvas" :class="{ editable }" @click="handleClick">
      <svg viewBox="0 0 300 180" preserveAspectRatio="none">
        <defs>
          <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#eef2f4" stroke-width="1" />
          </pattern>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#12a37a" />
            <stop offset="100%" stop-color="#3b82f6" />
          </linearGradient>
        </defs>
        <rect width="300" height="180" fill="url(#grid)" />
        <polyline v-if="path" :points="path" fill="none" stroke="url(#routeGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-for="(p, i) in plotted" :key="i" :cx="p.x" :cy="p.y" r="2.4" fill="#fff" stroke="#12a37a" stroke-width="1.4" />
        <circle v-if="plotted.length" :cx="plotted[0].x" :cy="plotted[0].y" r="5" fill="#12a37a" />
        <circle v-if="plotted.length > 1" :cx="plotted[plotted.length - 1].x" :cy="plotted[plotted.length - 1].y" r="5" fill="#ef4444" />
      </svg>
      <div v-if="!plotted.length" class="route-empty">
        {{ editable ? '点击空白处绘制轨迹（双击撤销）' : '没有轨迹数据' }}
      </div>
    </div>
    <div class="route-meta">
      <div class="meta-item">
        <span class="muted tiny">距离</span>
        <b class="num">{{ distanceKm.toFixed(2) }} km</b>
      </div>
      <div class="meta-item">
        <span class="muted tiny">平均配速</span>
        <b class="num">{{ paceText }}</b>
      </div>
      <div class="meta-item">
        <span class="muted tiny">轨迹点</span>
        <b class="num">{{ plotted.length }}</b>
      </div>
      <el-button v-if="editable && plotted.length" link type="danger" size="small" @click.stop="clear">清除</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ points?: [number, number][] | string | null; durationMin?: number; editable?: boolean }>(),
  { editable: false, durationMin: 0 },
)
const emit = defineEmits<{ (e: 'update:points', value: [number, number][]): void }>()

const internal = ref<[number, number][]>([])

watch(
  () => props.points,
  (v) => {
    if (!v) {
      internal.value = []
      return
    }
    if (typeof v === 'string') {
      try {
        internal.value = JSON.parse(v)
      } catch {
        internal.value = []
      }
    } else {
      internal.value = v
    }
  },
  { immediate: true },
)

/** 把经纬度映射到 300×180 画布 */
const bounds = computed(() => {
  const pts = internal.value
  if (!pts.length) return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 }
  const lats = pts.map((p) => p[0])
  const lngs = pts.map((p) => p[1])
  const padLat = Math.max(0.0005, (Math.max(...lats) - Math.min(...lats)) * 0.15)
  const padLng = Math.max(0.0005, (Math.max(...lngs) - Math.min(...lngs)) * 0.15)
  return {
    minLat: Math.min(...lats) - padLat,
    maxLat: Math.max(...lats) + padLat,
    minLng: Math.min(...lngs) - padLng,
    maxLng: Math.max(...lngs) + padLng,
  }
})

const plotted = computed(() =>
  internal.value.map(([lat, lng]) => {
    const b = bounds.value
    const x = b.maxLng === b.minLng ? 150 : ((lng - b.minLng) / (b.maxLng - b.minLng)) * 280 + 10
    const y = b.maxLat === b.minLat ? 90 : (1 - (lat - b.minLat) / (b.maxLat - b.minLat)) * 160 + 10
    return { x, y }
  }),
)

const path = computed(() => plotted.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const distanceKm = computed(() => {
  let total = 0
  for (let i = 1; i < internal.value.length; i++) total += haversine(internal.value[i - 1], internal.value[i])
  return total
})

const paceText = computed(() => {
  if (!distanceKm.value || !props.durationMin) return '—'
  const pace = props.durationMin / distanceKm.value
  const min = Math.floor(pace)
  const sec = Math.round((pace - min) * 60)
  return `${min}'${String(sec).padStart(2, '0')}" / km`
})

function handleClick(e: MouseEvent) {
  if (!props.editable) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  // 映射到一个约 1.2km × 0.8km 的虚构片区，便于计算距离
  const lat = 31.23 + (1 - y) * 0.008
  const lng = 121.47 + x * 0.012
  const next: [number, number][] = [...internal.value, [Number(lat.toFixed(5)), Number(lng.toFixed(5))]]
  internal.value = next
  emit('update:points', next)
}

function clear() {
  internal.value = []
  emit('update:points', [])
}
</script>

<style scoped>
.route {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.route-canvas {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.route-canvas.editable {
  cursor: crosshair;
}
.route-canvas svg {
  display: block;
  width: 100%;
  height: 180px;
}
.route-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--ink-400);
  pointer-events: none;
}
.route-meta {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 12px;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-item b {
  font-size: 13px;
  color: var(--ink-900);
}
</style>
