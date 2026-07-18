interface ConfirmState {
  id: string
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (v: boolean) => void
}

const pending = ref<ConfirmState | null>(null)

export function useConfirm() {
  return {
    pending: readonly(pending),
    ask(options: {
      message: string
      title?: string
      confirmLabel?: string
      cancelLabel?: string
      danger?: boolean
    }): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `c-${Date.now()}`
        // ponytail: replace any prior pending confirm so the new one shows.
        // A stale resolve(false) is the safest default for the displaced one.
        if (pending.value) pending.value.resolve(false)
        pending.value = { id, resolve, ...options }
      })
    },
    resolve(v: boolean) {
      if (pending.value) {
        pending.value.resolve(v)
        pending.value = null
      }
    },
  }
}
