// ponytail: self-check for LQIP generation. Run: npm run lqip:check
// Verifies the sharp pipeline produces a valid base64 webp data URI within a
// bounded byte size — the one invariant the gallery placeholder relies on.
// Not a unit-test framework; a single runnable assertion, deleted/ignored by Nitro.

async function main() {
  const sharp = (await import('sharp')).default
  // 100×100 synthetic image, larger than the 20×20 LQIP target — exercises the resize+blur+webp path
  const src = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer()
  const buf = await sharp(src).resize(20, 20, { fit: 'cover' }).blur(2).webp({ quality: 40 }).toBuffer()
  const dataUri = `data:image/webp;base64,${buf.toString('base64')}`

  const ok = dataUri.startsWith('data:image/webp;base64,') && buf.length > 0 && buf.length < 600
  if (!ok) {
    console.error(`LQIP self-check FAILED: ${buf.length} bytes, prefix=${dataUri.slice(0, 30)}`)
    process.exit(1)
  }
  console.log(`LQIP self-check OK: ${buf.length} bytes`)
}

main().catch((e) => { console.error(e); process.exit(1) })
