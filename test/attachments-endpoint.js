import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BEARER_TOKEN,
  createPartialPhotoBlob,
  createTestServer,
} from './test-helpers.js'

test('returns 502 for an attachment that is only partly synced', async (t) => {
  const server = createTestServer(t)
  await server.listen()

  const projectPublicId = await server.comapeo.createProject({
    name: 'project',
  })
  const project = await server.comapeo.getProject(projectPublicId)
  const blob = await createPartialPhotoBlob(t, project)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${projectPublicId}/attachments/${blob.driveId}/photo/${blob.name}`,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(response.statusCode, 502)
  assert.equal(response.json().error.code, 'ATTACHMENT_UPSTREAM_UNAVAILABLE')
})
