<template>
  <section class="card section">
    <div v-if="title" class="card-head">
      <div class="col gap-4">
        <span class="card-title">{{ title }}</span>
        <span v-if="sub" class="card-sub">{{ sub }}</span>
      </div>
      <div class="card-extra">
        <slot name="extra" />
      </div>
    </div>
    <div :class="padding ? 'card-pad' : ''">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ title?: string; sub?: string; padding?: boolean }>(), { padding: true })
</script>

<style scoped>
.section {
  overflow: hidden;
}
</style>
