<script setup lang="ts">
const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)

async function submit() {
  if (!username.value || !password.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await login(username.value, password.value)
    if (result.is_admin) {
      await navigateTo('/')
    } else {
      error.value = '登录成功但无管理员权限'
    }
  } catch (e: any) {
    error.value = '用户名或密码错误'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-16" style="padding-top: var(--space-page-top);">
    <div class="text-center mb-8" style="animation: searchIn var(--duration-slow) var(--ease-out);">
      <h1 class="gradient-text mb-2" style="font-size: var(--font-size-display); font-weight: 700; font-family: var(--font-display);">登录</h1>
      <p class="text-sm text-[var(--text-muted)]">管理员登录</p>
    </div>

    <form @submit.prevent="submit" class="card p-6 space-y-4">
      <div>
        <label for="username" class="text-sm font-medium text-[var(--text-muted)] block mb-1.5">用户名</label>
        <input
          id="username"
          name="username"
          v-model="username"
          type="text"
          required
          placeholder="输入用户名"
          autocomplete="username"
          class="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
        />
      </div>
      <div>
        <label for="password" class="text-sm font-medium text-[var(--text-muted)] block mb-1.5">密码</label>
        <div class="relative">
          <input
            id="password"
            name="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            required
            placeholder="输入密码"
            autocomplete="current-password"
            class="w-full px-3 py-2 pr-10 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
          />
          <button
            type="button"
            @click="showPassword = !showPassword"
            class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
          >
            <!-- Eye icon -->
            <svg v-if="!showPassword" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          </button>
        </div>
      </div>
      <div v-if="error" class="text-sm text-[var(--color-danger)]">{{ error }}</div>
      <button
        type="submit"
        :disabled="loading"
        class="w-full py-2.5 rounded-[var(--radius-button)] font-medium text-sm transition-all active:scale-95"
        style="background: var(--accent-color); color: var(--bg-primary);"
      >{{ loading ? '登录中…' : '登录' }}</button>
    </form>
  </div>
</template>
