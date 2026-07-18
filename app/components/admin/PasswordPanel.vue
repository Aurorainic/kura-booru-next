<script setup lang="ts">
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const message = ref('')
const saving = ref(false)

async function submit() {
  if (!currentPassword.value || !newPassword.value) return
  if (newPassword.value !== confirmPassword.value) {
    message.value = '两次密码不一致'
    return
  }
  if (newPassword.value.length < 6) {
    message.value = '新密码至少 6 位'
    return
  }
  saving.value = true
  message.value = ''
  try {
    await changePassword(currentPassword.value, newPassword.value)
    message.value = '✓ 密码已修改，请重新登录'
    // F-C-8: Redirect to login after password change (old session invalidated)
    setTimeout(() => { window.location.href = '/login' }, 1500)
  } catch {
    message.value = '✗ 当前密码错误或网络错误'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-md space-y-4">
    <PageHeader title="修改密码" subtitle="修改密码后将立即登出，需重新登录。" />

    <form @submit.prevent="submit" class="dash-card !p-5 space-y-4">
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">当前密码</label>
        <input v-model="currentPassword" type="password" autocomplete="current-password" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
      </div>
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">新密码</label>
        <input v-model="newPassword" type="password" minlength="6" autocomplete="new-password" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
        <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">至少 6 个字符</p>
      </div>
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">确认新密码</label>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors" :class="confirmPassword && newPassword !== confirmPassword ? 'border-red-400' : ''" :style="{ borderColor: confirmPassword && newPassword !== confirmPassword ? '' : 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
        <p v-if="confirmPassword && newPassword !== confirmPassword" class="text-[0.625rem] text-red-400 mt-1">密码不匹配</p>
      </div>
      <div v-if="message" class="text-sm font-medium px-3 py-2 rounded-xl" :style="message.startsWith('✓') ? { color: 'var(--color-success)', background: 'var(--color-success)/10' } : { color: 'var(--color-danger)', background: 'var(--color-danger)/10' }">{{ message }}</div>
      <button type="submit" :disabled="saving" class="btn-primary w-full !justify-center !px-5 !py-2.5 !text-sm">
        {{ saving ? '修改中…' : '修改密码' }}
      </button>
    </form>
  </div>
</template>
