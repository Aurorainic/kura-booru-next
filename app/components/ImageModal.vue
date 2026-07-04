<script setup lang="ts">
const props = defineProps<{
  src: string
  alt?: string
  detailHref?: string
}>()
const showModal = defineModel<boolean>({ default: false })

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
let startX = 0, startY = 0
// Pinch state
let pinchStartDist = 0
let pinchStartScale = 1
let pinchMidX = 0
let pinchMidY = 0

function resetTransform() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

watch(showModal, (v) => { if (!v) resetTransform() })

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  scale.value = Math.min(8, Math.max(0.5, scale.value + delta))
}

function onMouseDown(e: MouseEvent) {
  // Only pan when zoomed in; at scale=1 let double-click handle zoom
  if (scale.value === 1) return
  isDragging.value = true
  startX = e.clientX - translateX.value
  startY = e.clientY - translateY.value
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = e.clientX - startX
  translateY.value = e.clientY - startY
}

function onMouseUp() {
  isDragging.value = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function onDoubleClick() {
  if (scale.value === 1) {
    scale.value = 2
  } else {
    resetTransform()
  }
}

// ── Pinch zoom (touch) ──
function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault()
    const [t1, t2] = [e.touches[0], e.touches[1]]
    pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    pinchStartScale = scale.value
    pinchMidX = (t1.clientX + t2.clientX) / 2
    pinchMidY = (t1.clientY + t2.clientY) / 2
  } else if (e.touches.length === 1 && scale.value > 1) {
    isDragging.value = true
    startX = e.touches[0].clientX - translateX.value
    startY = e.touches[0].clientY - translateY.value
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault()
    const [t1, t2] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    if (pinchStartDist > 0) {
      const ratio = dist / pinchStartDist
      scale.value = Math.min(8, Math.max(0.5, pinchStartScale * ratio))
    }
  } else if (e.touches.length === 1 && isDragging.value) {
    translateX.value = e.touches[0].clientX - startX
    translateY.value = e.touches[0].clientY - startY
  }
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) pinchStartDist = 0
  if (e.touches.length === 0) isDragging.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showModal.value) showModal.value = false
}

function goToDetail() {
  if (props.detailHref) {
    showModal.value = false
    navigateTo(props.detailHref)
  } else {
    showModal.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    v-if="showModal"
    id="image-modal"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: oklch(0% 0 0 / 0.9);"
    role="dialog"
    aria-modal="true"
    :aria-label="alt || '图片预览'"
    @click.self="showModal = false"
  >
    <img
      :src="src"
      :alt="alt"
      class="max-w-full max-h-full object-contain touch-none"
      :class="{ 'cursor-grab': scale > 1, 'cursor-grabbing': isDragging, 'cursor-zoom-in': scale === 1 }"
      :style="{
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
      }"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @dblclick="onDoubleClick"
      @touchstart.prevent="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend="onTouchEnd"
      @click.stop
      draggable="false"
    />
    <button
      type="button"
      class="absolute top-4 left-4 px-3 h-9 flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
      @click="goToDetail"
      aria-label="详情页"
    >
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5m5 0v5" /></svg>
      详情
    </button>
    <button
      type="button"
      class="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
      @click="showModal = false"
      aria-label="关闭"
    >✕</button>
  </div>
</template>
