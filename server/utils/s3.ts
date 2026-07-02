import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// ponytail: singleton S3 client — provider-agnostic, switch via env vars
const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
})

const BUCKET = process.env.S3_BUCKET || 'kura-booru'
const EXTERNAL_URL = process.env.S3_EXTERNAL_URL || ''

export function getS3Url(key: string): string {
  if (EXTERNAL_URL) return `${EXTERNAL_URL}/${key}`
  return `/i/${key}`
}

export async function uploadToS3(key: string, body: Buffer | Uint8Array, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
}

export async function deleteFromS3(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export async function getPresignedUrl(key: string, expiresInSeconds = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds })
}

export async function deleteS3Objects(...keys: string[]) {
  await Promise.all(keys.map(k => deleteFromS3(k).catch(() => {})))
}
