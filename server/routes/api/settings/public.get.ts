
export default defineEventHandler(async (event) => {
  const settings = await getPublicSettings()

  // ETag support
  const crypto = await import('crypto')
  const etag = '"' + crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0, 32) + '"'
  const ifNoneMatch = getHeader(event, 'if-none-match')
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  setResponseHeader(event, 'ETag', etag)
  return settings
})
