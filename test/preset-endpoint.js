import { MapeoManager } from '@comapeo/core'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BEARER_TOKEN,
  createTestServer,
  generatePreset,
  getManagerOptions,
  randomAddProjectBody,
  randomProjectPublicId,
  runWithRetries,
} from './test-helpers.js'

/** @import { ObservationValue } from '@comapeo/schema'*/
/** @import { FastifyInstance } from 'fastify' */
/** @import {Static} from '@sinclair/typebox' */
/** @import {Preset} from '../src/datatypes/preset.js' */

test('returns a 401 if no auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${randomProjectPublicId()}/preset`,
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('returns a 401 if incorrect auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${randomProjectPublicId()}/preset`,
    headers: { Authorization: 'Bearer bad' },
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('returning no presets', async (t) => {
  const server = createTestServer(t)
  const projectKeys = randomAddProjectBody()
  const projectPublicId = projectKeyToPublicId(
    Buffer.from(projectKeys.projectKey, 'hex'),
  )

  const addProjectResponse = await server.inject({
    method: 'PUT',
    url: '/projects',
    body: projectKeys,
  })
  assert.equal(addProjectResponse.statusCode, 200)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${projectPublicId}/preset`,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(await response.json(), { data: [] })
})

test('returning presets with fetchable fields and icons', async (t) => {
  const server = createTestServer(t)

  const serverAddress = await server.listen()
  const serverUrl = new URL(serverAddress)

  const manager = new MapeoManager(getManagerOptions())
  const projectId = await manager.createProject({ name: 'CoMapeo project' })
  const project = await manager.getProject(projectId)

  await project.$member.addServerPeer(serverAddress, {
    dangerouslyAllowInsecureConnections: true,
  })

  project.$sync.start()
  project.$sync.connectServers()

  const presets = await generatePreset(project)

  await project.$sync.waitForSync('full')

  // It's possible that the client thinks it's synced but the server hasn't
  // processed everything yet, so we try a few times.
  const gotPresets =
    /** @type {import('@sinclair/typebox').Static<Preset>[]}*/ (
      await runWithRetries(3, async () => {
        const response = await server.inject({
          authority: serverUrl.host,
          method: 'GET',
          url: `/projects/${projectId}/preset`,
          headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
        })
        assert.equal(response.statusCode, 200)

        const { data } = await response.json()
        assert.equal(data.length, presets.length)
        return data
      })
    )

  for (const preset of presets) {
    const found = gotPresets.find(({ docId }) => docId === preset.docId)
    assert(found, 'preset got returned')
    const { fieldRefs, iconRef, ...generalData } = found
    const { fieldRefs: _, iconRef: _2, forks: _3, ...expectedData } = preset
    assert.deepEqual(generalData, expectedData, 'general preset fields match')

    assert(fieldRefs, 'preset has fieldRefs')
    if (!fieldRefs.length) continue
    assert(fieldRefs[0]?.url, 'refs have url')

    const fieldResponse = await server.inject({
      method: 'GET',
      url: new URL(fieldRefs[0].url).pathname,
      headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
    })
    assert.equal(
      fieldResponse.statusCode,
      200,
      'able to fetch field from ref URL',
    )

    const { data: fetchedField } = await fieldResponse.json()
    assert.equal(fetchedField.schemaName, 'field')

    if (!iconRef) continue
    const iconResponse = await server.inject({
      method: 'GET',
      url: new URL(iconRef.url).pathname,
      headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
    })
    assert.equal(
      iconResponse.statusCode,
      200,
      'able to fetch icon from ref URL',
    )
  }
})
