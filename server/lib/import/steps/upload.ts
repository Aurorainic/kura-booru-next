/**
 * S3 upload step — uploads all image variants concurrently.
 * Key convention (ADR-0003): one base UUID per image, width-suffixed
 * (<base>-300w/640w/1280w/2000w.webp); original keeps its own <uuid>.<ext> key.
 */
import crypto from 'crypto'
import { uploadToS3 } from '../../../utils/s3'
import type { ThumbnailResult } from './thumbnails'

export interface UploadResult {
  imageKey: string
  thumbKey: string
  midKey: string
  previewKey: string
  largeKey: string
}

export async function uploadImages(
  imageBuffer: Buffer,
  thumbs: ThumbnailResult,
  mimeType: string,
): Promise<UploadResult> {
  const ext = mimeType?.split('/')[1] || 'png'
  const imageKey = `${crypto.randomUUID()}.${ext}`
  const base = crypto.randomUUID()
  const thumbKey = thumbs.thumbBuffer ? `${base}-300w.webp` : ''
  const midKey = thumbs.midBuffer ? `${base}-640w.webp` : ''
  const previewKey = thumbs.previewBuffer ? `${base}-1280w.webp` : ''
  const largeKey = thumbs.largeBuffer ? `${base}-2000w.webp` : ''

  await Promise.all([
    uploadToS3(imageKey, imageBuffer, mimeType || 'image/png'),
    thumbs.thumbBuffer ? uploadToS3(thumbKey, thumbs.thumbBuffer, 'image/webp') : Promise.resolve(),
    thumbs.midBuffer ? uploadToS3(midKey, thumbs.midBuffer, 'image/webp') : Promise.resolve(),
    thumbs.previewBuffer ? uploadToS3(previewKey, thumbs.previewBuffer, 'image/webp') : Promise.resolve(),
    thumbs.largeBuffer ? uploadToS3(largeKey, thumbs.largeBuffer, 'image/webp') : Promise.resolve(),
  ])

  return { imageKey, thumbKey, midKey, previewKey, largeKey }
}
