import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Config } from './settings'

let _s3: S3Client | null = null
let _configSig = ''

async function currentS3Config() {
  return getS3Config()
}

async function getClient(): Promise<S3Client> {
  const cfg = await currentS3Config()
  const sig = JSON.stringify([cfg.region, cfg.endpoint, cfg.accessKeyId, cfg.secretAccessKey])
  if (!_s3 || _configSig !== sig) {
    _s3 = new S3Client({
      region: cfg.region || 'auto',
      endpoint: cfg.endpoint || undefined,
      // S3 兼容存储（rustfs/MinIO 类）只支持 path-style；SDK 默认 virtual-host
      // 会把 bucket 拼成子域（kura-booru-images.host.docker.internal），DNS 必然失败。
      forcePathStyle: true,
      credentials: {
        accessKeyId: cfg.accessKeyId || '',
        secretAccessKey: cfg.secretAccessKey || '',
      },
    })
    _configSig = sig
  }
  return _s3
}

/** 强制下次调用重建客户端（settings 热刷新时由 onSettingsChanged 调用）。 */
export function resetS3Client() {
  _s3 = null
  _configSig = ''
}

export async function getBucketName(): Promise<string> {
  const cfg = await currentS3Config()
  return cfg.bucket || 'kura-booru'
}

export async function getS3ExternalUrl(): Promise<string> {
  const cfg = await currentS3Config()
  return cfg.externalUrl || ''
}

export function getS3Url(key: string): string {
  // 同步包装：外部 URL 通常稳定，但为热刷新一致性走异步读取源；调用方多为渲染路径。
  return `/i/${key}`
}

export async function getS3UrlAsync(key: string): Promise<string> {
  const external = await getS3ExternalUrl()
  return external ? `${external}/${key}` : `/i/${key}`
}

export async function uploadToS3(key: string, body: Buffer | Uint8Array, contentType: string) {
  const client = await getClient()
  const bucket = await getBucketName()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
}

export async function deleteFromS3(key: string) {
  const client = await getClient()
  const bucket = await getBucketName()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

export async function getPresignedUrl(key: string, expiresInSeconds = 3600) {
  const client = await getClient()
  const bucket = await getBucketName()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds })
}

export async function deleteS3Objects(...keys: string[]) {
  await Promise.all(keys.map(k => deleteFromS3(k).catch(() => {})))
}

/** 测试 S3 连接：临时客户端 HeadBucket 验证凭据与桶可达；ok=false 时 error 为可读原因。 */
export async function testS3Connection(): Promise<{ ok: boolean; error?: string; bucket?: string; region?: string; endpoint?: string }> {
  const cfg = await currentS3Config()
  if (!cfg.accessKeyId && !cfg.secretAccessKey) {
    return { ok: false, error: 'S3 Access Key / Secret Key 未配置' }
  }
  if (!cfg.bucket) {
    return { ok: false, error: 'S3 Bucket 未配置' }
  }
  try {
    const client = await getClient()
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
    return { ok: true, bucket: cfg.bucket, region: cfg.region, endpoint: cfg.endpoint || '(默认)' }
  } catch (err: any) {
    const msg = err?.message || String(err)
    // HeadBucket 对部分 Provider（如 R2）返回 403 但 ListBuckets 可用 — 给一次兜底，避免误报。
    try {
      const client = await getClient()
      await client.send(new ListBucketsCommand({}))
      return { ok: true, bucket: cfg.bucket, region: cfg.region, endpoint: cfg.endpoint || '(默认)', error: `HeadBucket 失败但 ListBuckets 成功：${msg}` }
    } catch {
      return { ok: false, error: msg, bucket: cfg.bucket, region: cfg.region, endpoint: cfg.endpoint || '(默认)' }
    }
  }
}
