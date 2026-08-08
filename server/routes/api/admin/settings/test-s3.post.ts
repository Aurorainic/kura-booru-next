import { defineAdminHandler } from '../../../../platform/http/auth'
import { testS3Connection } from '../../../../utils/s3'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/settings/test-s3', summary: 'Test S3 storage connection' },
  handler: async () => {
    return testS3Connection()
  },
})
