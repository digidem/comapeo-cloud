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

test('reports an attachment that could not be served', async (t) => {
  /** @type {Array<{ message: string, context: any }>} */
  const events = []
  const server = createTestServer(t, {
    captureMessage(message, context) {
      events.push({ message, context })
    },
  })
  await server.listen()

  const projectPublicId = await server.comapeo.createProject({
    name: 'project',
  })
  const project = await server.comapeo.getProject(projectPublicId)
  const blob = await createPartialPhotoBlob(t, project)

  await server.inject({
    method: 'GET',
    url: `/projects/${projectPublicId}/attachments/${blob.driveId}/photo/${blob.name}`,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })

  assert.equal(events.length, 1)
  const [event] = events
  assert.equal(event?.message, 'attachment.nonok')
  assert.equal(event?.context.level, 'warning')
  assert.deepEqual(event?.context.tags, {
    project: projectPublicId,
    drive: blob.driveId.slice(0, 7),
    type: 'photo',
    variant: 'original',
    class: 'incomplete',
    http_status: 502,
  })
})
