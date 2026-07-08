<script setup lang="ts">
const showModal = defineModel<boolean>({ default: false })

function close() { showModal.value = false }
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape' && showModal.value) close() }
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

const groups = [
  {
    title: '导航',
    items: [
      { keys: ['J'], desc: '下一张作品（详情页）' },
      { keys: ['K'], desc: '上一张作品（详情页）' },
      { keys: ['→'], desc: '下一页（列表页）' },
      { keys: ['←'], desc: '上一页（列表页）' },
      { keys: ['G+T'], desc: '跳转到标签页' },
      { keys: ['Esc'], desc: '关闭弹窗 / 返回' },
    ],
  },
  {
    title: '搜索',
    items: [
      { keys: ['/'], desc: '聚焦搜索框' },
      { keys: ['Enter'], desc: '执行搜索' },
      { keys: ['↑', '↓'], desc: '选择搜索建议' },
    ],
  },
  {
    title: '图片',
    items: [
      { keys: ['滚轮'], desc: '缩放（弹窗内）' },
      { keys: ['双击'], desc: '切换 1× / 2× 缩放' },
      { keys: ['拖拽'], desc: '平移（缩放状态下）' },
      { keys: ['双指 pinch'], desc: '触屏缩放' },
    ],
  },
  {
    title: '本页',
    items: [
      { keys: ['?'], desc: '显示 / 隐藏此快捷键面板' },
    ],
  },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="showModal"
        class="fixed inset-0 z-[120] flex items-center justify-center p-4"
        style="background: oklch(0% 0 0 / 0.55);"
        role="dialog"
        aria-modal="true"
        aria-label="快捷键"
        @click.self="close"
      >
        <div class="w-full max-w-lg rounded-[var(--radius-lg)] bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-2xl overflow-hidden" style="animation: modalZoomIn var(--duration-instant) var(--ease-out) both;">
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-color)]">
            <h2 class="text-sm font-semibold text-[var(--text-primary)]">键盘快捷键</h2>
            <button class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--bg-surface)] text-[var(--text-muted)]" @click="close" aria-label="关闭">✕</button>
          </div>
          <div class="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            <div v-for="g in groups" :key="g.title">
              <h3 class="text-[0.6875rem] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">{{ g.title }}</h3>
              <ul class="space-y-1.5">
                <li v-for="it in g.items" :key="it.desc" class="flex items-center justify-between gap-3">
                  <span class="text-[0.8125rem] text-[var(--text-primary)]">{{ it.desc }}</span>
                  <Kbd :keys="it.keys" />
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
