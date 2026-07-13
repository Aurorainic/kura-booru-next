// ponytail: shared accent-hue span used by SSR (app/layouts/default.vue) and
// the runtime picker (app/components/AccentPicker.vue). Keep these in one
// place so the gradient end and the slider end stay in lockstep.
export const ACCENT_HUE_SPAN = 25
export const ACCENT_HUE_DEFAULT = 175

export function accentEndHue(start: number) {
  return start + ACCENT_HUE_SPAN
}
