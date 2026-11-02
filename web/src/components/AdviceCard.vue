<template>
  <div class="advice" :class="`lv-${advice.level}`">
    <div class="advice-head">
      <span class="dot" />
      <span class="title">{{ advice.title }}</span>
      <span class="pill" :class="levelPill">{{ levelText }}</span>
      <span v-if="advice.adjustment" class="pill pill-plain">{{ advice.adjustment }}</span>
      <span class="cat">{{ categoryText }}</span>
    </div>
    <p class="summary">{{ advice.summary }}</p>

    <div class="evidence">
      <div class="ev-label">数据依据</div>
      <ul>
        <li v-for="(e, i) in advice.evidence" :key="i">{{ e }}</li>
      </ul>
    </div>

    <div v-if="advice.actions.length" class="actions">
      <div class="ev-label">可以怎么做</div>
      <div v-for="(a, i) in advice.actions" :key="i" class="action">
        <span class="idx">{{ i + 1 }}</span>
        <span>{{ a }}</span>
      </div>
    </div>

    <div class="advice-foot">
      <span>置信度 {{ Math.round(advice.confidence * 100) }}%</span>
      <span class="muted">·</span>
      <span class="muted">基于近 14–28 天数据</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Advice } from '@/types/api'

const props = defineProps<{ advice: Advice }>()

const levelText = computed(
  () => ({ good: '正向', info: '提示', warn: '需调整', danger: '优先处理' })[props.advice.level] ?? '提示',
)
const levelPill = computed(
  () => ({ good: 'pill-good', info: 'pill-info', warn: 'pill-warn', danger: 'pill-danger' })[props.advice.level] ?? 'pill-plain',
)
const categoryText = computed(
  () => ({ data: '数据质量', diet: '饮食', exercise: '运动', habit: '习惯', goal: '目标' })[props.advice.category] ?? '',
)
</script>

<style scoped>
.advice {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px 18px;
  background: #fff;
  position: relative;
  overflow: hidden;
}
.advice::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--ink-300);
}
.advice.lv-good::before {
  background: var(--brand);
}
.advice.lv-info::before {
  background: var(--info);
}
.advice.lv-warn::before {
  background: var(--accent);
}
.advice.lv-danger::before {
  background: var(--danger);
}
.advice-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
  display: none;
}
.title {
  font-size: 14px;
  font-weight: 650;
  color: var(--ink-900);
}
.cat {
  font-size: 11px;
  color: var(--ink-400);
  margin-left: auto;
}
.summary {
  margin: 9px 0 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--ink-700);
}
.evidence {
  margin-top: 12px;
  background: #fafbfc;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}
.ev-label {
  font-size: 11px;
  color: var(--ink-400);
  letter-spacing: 0.4px;
  margin-bottom: 6px;
  font-weight: 600;
}
.evidence ul {
  margin: 0;
  padding-left: 16px;
}
.evidence li {
  font-size: 12px;
  line-height: 1.85;
  color: var(--ink-700);
  font-variant-numeric: tabular-nums;
}
.actions {
  margin-top: 12px;
}
.action {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--ink-700);
  margin-bottom: 4px;
}
.idx {
  flex: 0 0 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 10px;
  display: grid;
  place-items: center;
  margin-top: 2px;
  font-weight: 700;
}
.advice-foot {
  margin-top: 12px;
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--ink-400);
}
</style>
