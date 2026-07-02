<script setup lang="ts">
defineProps<{
  src: string
  alt?: string
}>()

const showModal = ref(false)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
let startX = 0, startY = 0

function open() {
  showModal.value = true
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function close() {
  showModal.value = false
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  scale.value = Math.min(3, Math.max(0.5, scale.value + delta))
}

function onMouseDown(e: MouseEvent) {
  isDragging.value = true
  startX = e.clientX - translateX.value
  startY = e.clientY - translateY.value
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = e.clientX - startX
  translateY.value = e.clientY - startY
}

function onMouseUp() {
  isDragging.value = false
}

function onDoubleClick() {
  if (scale.value === 1) {
    scale.value = 2
  } else {
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showModal.value) close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ open, close })
</script>

<template>
  <div
    v-if="showModal"
    id="image-modal"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: oklch(0% 0 0 / 0.9);"
    @click.self="close"
  >
    <img
      :src="src"
      :alt="alt"
      class="max-w-full max-h-full object-contain cursor-grab"
      :class="{ 'cursor-grabbing': isDragging }"
      :style="{
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
      }"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @dblclick="onDoubleClick"
      @click.stop
    />
    <button
      type="button"
      class="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
      @click="close"
      aria-label="关闭"
    >✕</button>
  </div>
</template>
