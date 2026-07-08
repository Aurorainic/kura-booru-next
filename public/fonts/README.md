# Display font subsets

Drop self-hosted woff2 subsets here to activate the `KuraDisplay` family
referenced by `--font-display` (H1 / page titles / tag names).

Recommended subsets (per `docs/theme-design.md` §6):
- `display-latin.woff2` — Latin glyphs (~20 KB)
- `display-cjk.woff2`   — CJK glyphs, subsetted to the site's actual characters (~60 KB)

Both are declared in a single `@font-face` in `assets/css/main.css` with
`font-display: swap`, so until the files exist the browser silently falls
through to the system CJK stack — no broken glyphs, no layout shift.

Suggested source families (all open-licensed):
- **HarmonyOS Sans** (Huawei, OFL-equivalent) — the design spec's first choice
- **Source Han Sans / 思源黑体** (Adobe, OFL) — universal fallback

Subset with pyftsubset / fonttools:
```sh
pyftsubset SourceHanSansSC.otf \
  --output-file=display-cjk.woff2 --flavor=woff2 \
  --unicodes-file=<chars-used-on-site.txt> --layout-features='*'
```
