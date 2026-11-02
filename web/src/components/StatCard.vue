<template>
  <div class="stat card" :class="[`tone-${tone}`, { clickable: !!$attrs.onClick }]">
    <div class="stat-head">
      <span class="stat-title">{{ title }}</span>
      <span v-if="icon" class="stat-icon">{{ icon }}</span>
    </div>
    <div class="stat-value num">
      <span class="v">{{ value }}</span>
      <span v-if="unit" class="u">{{ unit }}</span>
    </div>
    <div class="stat-foot">
      <span v-if="hint" class="stat-hint">{{ hint }}</span>
      <slot name="foot" />
    </div>
    <el-progress
      v-if="progress !== undefined && progress !== null"
      :percentage="Math.min(100, Math.max(0, progress))"
      :stroke-width="5"
      :show-text="false"
      :color="barColor"
      class="stat-bar"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  value: string | number
  unit?: string
  hint?: string
  icon?: string
  tone?: 'good' | 'warn' | 'danger' | 'info' | 'neutral'
  progress?: number | null
}>()

const tone = computed(() => props.tone ?? 'neutral')
const barColor = computed(() => {
  if (props.tone === 'danger') return '#ef4444'
  if (props.tone === 'warn') return '#f59e0b'
  if (props.tone === 'info') return '#3b82f6'
  return '#12a37a'
})
</script>

<style scoped>
.stat {
  padding: 16px 18px 14px;
  position: relative;
  overflow: hidden;
}
.stat.clickable {
  cursor: pointer;
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}
.stat.clickable:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-title {
  font-size: 12.5px;
  color: var(--ink-500);
  font-weight: 500;
}
.stat-icon {
  font-size: 15px;
  opacity: 0.55;
}
.stat-value {
  margin-top: 8px;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.stat-value .v {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -1px;
  color: var(--ink-900);
}
.stat-value .u {
  font-size: 12px;
  color: var(--ink-400);
  font-weight: 500;
}
.stat-foot {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-500);
  min-height: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.stat-bar {
  margin-top: 10px;
}
.tone-good .stat-value .v {
  color: var(--brand-dark);
}
.tone-danger .stat-value .v {
  color: #c81e1e;
}
.tone-warn .stat-value .v {
  color: #b45309;
}
</style>
