// Seed DB settings from env (or defaults) on first boot. v0.10.0: env vars are
// only the bootstrap source — seed once, then the admin panel owns them.

export default defineNitroPlugin(async () => {
  try {
    const { seedSettingsFromEnv } = await import('../utils/settings')
    await seedSettingsFromEnv()
    console.log('[seed-settings] settings seeded from env (idempotent)')
  } catch (err) {
    console.error('[seed-settings] failed to seed settings:', err)
  }
})
