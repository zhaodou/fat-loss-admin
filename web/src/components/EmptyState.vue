<template>
  <div class="empty">
    <div class="empty-icon">{{ icon }}</div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="description" class="empty-desc">{{ description }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ icon?: string; title: string; description?: string }>(), { icon: '🌱' })
</script>

<style scoped>
.empty {
  padding: 34px 16px;
  text-align: center;
  color: var(--ink-500);
}
.empty-icon {
  font-size: 26px;
  margin-bottom: 8px;
  opacity: 0.8;
}
.empty-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-700);
}
.empty-desc {
  font-size: 12px;
  margin-top: 6px;
  line-height: 1.7;
}
</style>
