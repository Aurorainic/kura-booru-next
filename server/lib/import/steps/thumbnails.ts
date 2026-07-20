/**
 * Thumbnail generation step — sharp-based, shared by single-image and multi-image paths.
 *
 * ADR-0003: extended from 3-piece (thumb/preview/LQIP) to 4-width srcset
 * (300w/640w/1280w/2000w) + LQIP 20². All webp, stored as independent S3 keys
 * with a shared base UUID + width suffix convention:
 *   <base>-300w.webp, <base>-640w.webp, <base>-1280w.webp, <base>-2000w.webp
 *
 * Frontend derives mid/large keys from thumb/preview by suffix replacement;
 * existing posts (pre-v0.9.0, old key format) fall back to single-image until
 * a one-off backfill updates them (already executed; the script was removed
 * from the repo after use).
 *
 * Sidecar keeps gallery-dl download + phash + raw dims/mime: phash needs
 * imagehash's exact DCT, and migrating it to sharp breaks cross-era dedup
 * (different Lanczos impls → ~6–14 bit Hamming drift on the same image,
 * at/above the dedup threshold of 8). Sharp re-derives dims/mime from the
 * uploaded bytes so they always match what we actually store.
 */

let _sharp: any = null
async function getSharp() {
  if (!_sharp) {
    try { _sharp = await import('sharp') }
    catch { console.error('[pipeline] sharp not installed — thumbnails disabled'); return null }
  }
  return _sharp
}

export interface ThumbnailResult {
  thumbBuffer: Buffer | null
  midBuffer: Buffer | null
  previewBuffer: Buffer | null
  largeBuffer: Buffer | null
  lqipDataUri: string | null
  width: number
  height: number
  mimeType: string
}

export async function generateThumbnails(
  imageBuffer: Buffer,
  fallbackWidth?: number,
  fallbackHeight?: number,
  fallbackMime?: string,
): Promise<ThumbnailResult> {
  const sharpMod = await getSharp()
  let thumbBuffer: Buffer | null = null
  let midBuffer: Buffer | null = null
  let previewBuffer: Buffer | null = null
  let largeBuffer: Buffer | null = null
  let lqipDataUri: string | null = null
  let width = fallbackWidth
  let height = fallbackHeight
  let mimeType = fallbackMime

  if (sharpMod) {
    const img = sharpMod.default(imageBuffer)
    ;[thumbBuffer, midBuffer, previewBuffer, largeBuffer] = await Promise.all([
      img.clone().resize(300, 300, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
      img.clone().resize(640, undefined, { fit: 'inside' }).webp({ quality: 82 }).toBuffer(),
      img.clone().resize(1280, undefined, { fit: 'inside' }).webp({ quality: 85 }).toBuffer(),
      img.clone().resize(2000, undefined, { fit: 'inside' }).webp({ quality: 85 }).toBuffer(),
    ])
    // LQIP: 20×20 webp blur → base64 data URI (embedded in API response, no extra request)
    const lqipBuf = await img.clone()
      .resize(20, 20, { fit: 'cover' })
      .blur(2)
      .webp({ quality: 40 })
      .toBuffer()
    lqipDataUri = `data:image/webp;base64,${lqipBuf.toString('base64')}`

    // Re-derive dims/mime from the actual image bytes — sidecar's values
    // come from Pillow on the downloaded file, sharp sees the same bytes so
    // they agree; sharp wins on conflict (it's the bytes we upload).
    const probed = await img.metadata()
    if (probed.width && probed.height) { width = probed.width; height = probed.height }
    if (probed.format) mimeType = `image/${probed.format === 'jpeg' ? 'jpeg' : probed.format}`
  }

  return { thumbBuffer, midBuffer, previewBuffer, largeBuffer, lqipDataUri, width: width!, height: height!, mimeType: mimeType! }
}
