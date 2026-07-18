<script setup lang="ts">
const props = defineProps<{
  aiStatus: AiStatus | null
  aiEnabled: boolean
}>()
</script>

<template>
  <div class="flex items-center gap-2 text-xs">
    <span
      class="w-2 h-2 rounded-full"
      :class="props.aiEnabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'"
    />
    <span class="text-[var(--text-muted)]">
      {{ props.aiEnabled ? `${props.aiStatus?.model}` : 'AI 未启用' }}
    </span>
    <span v-if="props.aiEnabled && props.aiStatus?.endpoint" class="text-[var(--text-muted)]/60">
      {{ (() => { try { return new URL(props.aiStatus.endpoint).hostname } catch { return '' } })() }}
    </span>
  </div>
</template>
