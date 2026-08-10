/**
 * Thumbnail generation step — sharp-based, shared by single and multi-image paths.
 * ADR-0003: 4-width srcset (300w/640w/1280w/2000w) + LQIP 20², webp keys
 * <base>-<width>w.webp; frontend derives mid/large keys by suffix replacement.
 * Sidecar keeps gallery-dl download + phash: phash needs imagehash's exact DCT
 * (sharp's Lanczos drifts 6–14 bits, at/above the dedup threshold of 8). Sharp
 * re-derives dims/mime from the uploaded bytes so they always match what we store.
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
  // Sizes from DB settings (thumb_size / preview_size), hot-reload.
  const { getImageSizes } = await import('../../../utils/settings')
  const sizes = await getImageSizes()
  const thumbSize = sizes.thumbSize
  const previewSize = sizes.previewSize
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
      img.clone().resize(thumbSize, thumbSize, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
      img.clone().resize(640, undefined, { fit: 'inside' }).webp({ quality: 82 }).toBuffer(),
      img.clone().resize(previewSize, undefined, { fit: 'inside' }).webp({ quality: 85 }).toBuffer(),
      img.clone().resize(2000, undefined, { fit: 'inside' }).webp({ quality: 85 }).toBuffer(),
    ])
    // LQIP: 20×20 webp blur → base64 data URI (embedded in API response, no extra request)
    const lqipBuf = await img.clone()
      .resize(20, 20, { fit: 'cover' })
      .blur(2)
      .webp({ quality: 40 })
      .toBuffer()
    lqipDataUri = `data:image/webp;base64,${lqipBuf.toString('base64')}`

    // sharp 不可用（未安装/加载失败）时用 sidecar fallback 尺寸/MIME。
    // Re-derive dims/mime from actual bytes: sidecar's Pillow values agree with
    // sharp on the same bytes; sharp wins on conflict (it's the bytes we upload).
    const probed = await img.metadata()
    if (probed.width && probed.height) { width = probed.width; height = probed.height }
    if (probed.format) mimeType = `image/${probed.format === 'jpeg' ? 'jpeg' : probed.format}`
  }

  return { thumbBuffer, midBuffer, previewBuffer, largeBuffer, lqipDataUri, width: width!, height: height!, mimeType: mimeType! }
}
