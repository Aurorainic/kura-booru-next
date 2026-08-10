/**
 * SSR-safe keycap display (⌘ vs Ctrl): inline head script writes a kura-platform cookie
 * before paint; SSR reads it via useCookie (default "mac", corrected on hydrate).
 */

export function usePlatform() {
  const cookie = useCookie<'mac' | 'pc'>('kura-platform', {
    default: () => 'mac',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
  })

  // Head script sets the cookie client-side only if missing; SSR uses the request cookie or 'mac' on cold visits.
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
