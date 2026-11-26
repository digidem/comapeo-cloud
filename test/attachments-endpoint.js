import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'

import { BEARER_TOKEN, createTestServer } from './test-helpers.js'

// Test-only internals, not in core's package exports or public types
const { kBlobStore, kCoreManager } = await import(
  new URL('../node_modules/@comapeo/core/src/mapeo-project.js', import.meta.url)
    .href
)

test('returns 502 for an attachment that is only partly synced', async (t) => {
  const server = createTestServer(t)
  await server.listen()

  const projectPublicId = await server.comapeo.createProject({
    name: 'project',
  })
  const project = await server.comapeo.getProject(projectPublicId)
  const internals = /** @type {any} */ (project)

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comapeo-cloud-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'original.jpg')
  // Three hypercore blocks (64 KiB each), so a partial blob is possible
  await fs.writeFile(filePath, randomBytes(3 * 64 * 1024))

  const blob = await project.$blobs.create(
    { original: filePath },
    { mimeType: 'image/jpeg' },
  )
  const entry = await internals[kBlobStore].entry({
    driveId: blob.driveId,
    type: 'photo',
    variant: 'original',
    name: blob.name,
  })
  assert(entry, 'test setup: blob entry exists')
  const { blockOffset, blockLength } = entry.value.blob
  // Keep block 0 and drop the rest, like an original mid-way through sync
  await internals[kCoreManager]
    .getWriterCore('blob')
    .core.clear(blockOffset + 1, blockOffset + blockLength)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${projectPublicId}/attachments/${blob.driveId}/photo/${blob.name}`,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(response.statusCode, 502)
  assert.equal(response.json().error.code, 'ATTACHMENT_UPSTREAM_UNAVAILABLE')
})
