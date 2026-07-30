export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration: number
}

const toasts = ref<Toast[]>([])

function push(type: ToastType, message: string, duration = 3000): string {
  // ponytail: crypto.randomUUID exists in both browser and Nitro's node runtime;
  // fall back to a counter-shaped id for SSR edge cases where crypto is absent.
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
    // NOTE: readonly() only creates a shallow proxy — it prevents reassignment
    // of the toasts array itself but does NOT deep-freeze individual Toast
    // objects. Callers who mutate a toast entry (e.g. toasts.value[0].message)
    // can still do so. This is accepted because the composable owns the array
    // and only reads it externally; direct mutation by consumers would be a
    // misuse rather than a silent data corruption. (M8 fix)
    toasts: readonly(toasts),
    success: (msg: string) => push('success', msg),
    error: (msg: string) => push('error', msg, 5000),
    info: (msg: string) => push('info', msg),
    dismiss,
  }
}
