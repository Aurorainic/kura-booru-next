// Generates signed imgproxy URLs (HMAC-SHA256, base64url path) for the
// srcset width ladder 100w–2000w, then curls each one and reports status
// + returned dimensions/bytes. Also exercises the SSRF guards:
//   - unsigned URL must be 403
//   - signed URL to a loopback source must be rejected (CVE-2025-24354)
//   - signed URL outside the allowed prefix must be rejected
// Usage: node sign.mjs   (reads .env.spike in this directory)
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const env = Object.fromEntries(
  readFileSync(new URL('./.env.spike', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => l.split('=').map((s) => s.trim())),
)
const KEY = Buffer.from(env.IMGPROXY_KEY_HEX, 'hex')
const SALT = Buffer.from(env.IMGPROXY_SALT_HEX, 'hex')
const BASE = 'http://127.0.0.1:8088'

const sign = (path) =>
  createHmac('sha256', KEY).update(SALT).update(path).digest('base64url')

const imgUrl = (sourceUrl, width, { signed = true } = {}) => {
  const path = `/rs:fit:${width}:0/${Buffer.from(sourceUrl).toString('base64url')}.webp`
  return signed ? `${BASE}/${sign(path)}${path}` : `${BASE}/insecure${path}`
}

const curl = (url, out) => {
  try {
    const code = execFileSync('curl', ['-sS', '-o', out, '-w', '%{http_code}', url], { encoding: 'utf8' }).trim()
    return { code: +code, out }
  } catch (e) {
    return { code: 0, out, err: e.message }
  }
}

const SRC = 'http://minio:9000/kura/posts/test.jpg'
let failures = 0
const report = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// 1. width ladder (srcset candidates): 100w .. 2000w
for (const w of [100, 240, 300, 640, 1280, 2000]) {
  const r = curl(imgUrl(SRC, w), `/tmp/spike-img-${w}.webp`)
  let dims = ''
  if (r.code === 200) {
    const info = execFileSync('file', ['-b', r.out], { encoding: 'utf8' }).trim()
    const bytes = execFileSync('stat', ['-c', '%s', r.out], { encoding: 'utf8' }).trim()
    dims = `${info.split(',')[2]?.trim() || info}, ${bytes}B`
  }
  report(`width ${w}w`, r.code === 200, `HTTP ${r.code} ${dims}`)
}

// 2. unsigned request rejected
{
  const r = curl(imgUrl(SRC, 300, { signed: false }), '/tmp/spike-img-unsigned.bin')
  report('unsigned URL rejected', r.code === 403, `HTTP ${r.code}`)
}

// 3. SSRF: loopback source rejected even with a valid signature (CVE-2025-24354)
//    imgproxy v4 answers these with 404 + "Loopback source address is not allowed"
for (const evil of ['http://127.0.0.1:8088/health', 'http://localhost:9000/minio/health/live']) {
  const r = curl(imgUrl(evil, 300), '/tmp/spike-img-evil.bin')
  report(`loopback source rejected: ${evil}`, [403, 404].includes(r.code), `HTTP ${r.code}`)
}

// 4. SSRF: source outside allowed prefix rejected even with a valid signature
{
  const r = curl(imgUrl('https://example.com/x.jpg', 300), '/tmp/spike-img-ext.bin')
  report('off-prefix source rejected', [403, 404].includes(r.code), `HTTP ${r.code}`)
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
process.exit(failures ? 1 : 0)
