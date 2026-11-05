import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BEARER_TOKEN,
  FIXTURE_AUDIO_PATH,
  FIXTURE_IMAGE_ORIGINAL_PATH,
  FIXTURE_IMAGE_PREVIEW_PATH,
  FIXTURE_IMAGE_THUMBNAIL_PATH,
  blobToAttachment,
  createPartialPhotoBlob,
  createTestServer,
  generateObservation,
} from './test-helpers.js'

test('returns a 401 if no auth is provided', async (t) => {
  const server = createTestServer(t)
  await server.listen()

  const projectPublicId = await server.comapeo.createProject({
    name: 'project',
  })

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${projectPublicId}/attachments/audit`,
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('counts every attachment variant and reports the partly synced one', async (t) => {
  const server = createTestServer(t)
  await server.listen()

  const projectPublicId = await server.comapeo.createProject({
    name: 'project',
  })
  const project = await server.comapeo.getProject(projectPublicId)

  const photo = await project.$blobs.create(
    {
      original: FIXTURE_IMAGE_ORIGINAL_PATH,
      preview: FIXTURE_IMAGE_PREVIEW_PATH,
      thumbnail: FIXTURE_IMAGE_THUMBNAIL_PATH,
    },
    { mimeType: 'image/jpeg' },
  )
  const audio = await project.$blobs.create(
    { original: FIXTURE_AUDIO_PATH },
    { mimeType: 'audio/mpeg' },
  )
  const partialPhoto = await createPartialPhotoBlob(t, project)
  await project.observation.create({
    ...generateObservation(),
    attachments: [blobToAttachment(photo), blobToAttachment(audio)],
  })
  await project.observation.create({
    ...generateObservation(),
    attachments: [blobToAttachment(partialPhoto)],
  })

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${projectPublicId}/attachments/audit`,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(response.statusCode, 200)
  /** @type {import('../src/attachments-audit.js').AttachmentAudit} */
  const { failures, ...counts } = response.json().data
  // 3 attachments: two photos with 3 variants each, one audio with 1
  assert.deepEqual(counts, {
    observations: 2,
    attachments: 3,
    audited: 3,
    ok: 6,
    missing: 0,
    incomplete: 1,
    error: 0,
  })
  assert.deepEqual(
    failures.map(({ detail: _detail, ...failure }) => failure),
    [
      {
        driveDiscoveryId: partialPhoto.driveId,
        type: 'photo',
        name: partialPhoto.name,
        variant: 'original',
        status: 'incomplete',
      },
    ],
  )
})
