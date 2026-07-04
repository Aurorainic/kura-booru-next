/**
 * SSR-safe platform detection for keyboard keycap display (⌘ vs Ctrl).
 *
 * Mirrors the theme anti-flash pattern (app/layouts/default.vue:46-53): an
 * inline <head> script runs before paint, reads navigator.platform, and writes
 * a `kura-platform` cookie. Server-side rendering reads the cookie via
 * useCookie so the first render already shows the correct keycap — no flash.
 *
 * Falls back to "mac" on first visit (before the cookie is set) which is the
 * more visually distinctive symbol; the inline script corrects it on hydrate.
 */

export function usePlatform() {
  const cookie = useCookie<'mac' | 'pc'>('kura-platform', {
    default: () => 'mac',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
  })

  // The inline head script (run before paint) sets the cookie client-side
  // only if it's missing. SSR uses whatever cookie value arrived with the
  // request, or the default ('mac') on a cold first visit.
  const isMac = computed(() => cookie.value === 'mac')

  const headScript = `
(function(){try{
  if(document.cookie.indexOf('kura-platform=')>=0)return;
  var p=navigator.platform||'';
  var mac=/Mac|iPhone|iPad|iPod/i.test(p);
  document.cookie='kura-platform='+(mac?'mac':'pc')+';max-age=31536000;path=/;samesite=lax';
}catch(e){}})();`

  useHead({
    script: [{ innerHTML: headScript, tagPosition: 'head' }],
  })

  return { isMac, platform: cookie }
}
