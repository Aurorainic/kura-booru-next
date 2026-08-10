export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration: number
}

const toasts = ref<Toast[]>([])

function push(type: ToastType, message: string, duration = 3000): string {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  toasts.value.push({ id, type, message, duration })
  if (import.meta.client) {
    setTimeout(() => dismiss(id), duration)
  }
  return id
}

function dismiss(id: string) {
  const i = toasts.value.findIndex(t => t.id === id)
  if (i >= 0) toasts.value.splice(i, 1)
}

export function useToast() {
  return {
    // NOTE: readonly() is a shallow proxy — toast entries can still be mutated; accepted since the composable owns the array. (M8 fix)
    toasts: readonly(toasts),
    success: (msg: string) => push('success', msg),
    error: (msg: string) => push('error', msg, 5000),
    info: (msg: string) => push('info', msg),
    dismiss,
  }
}
