import { MapeoManager } from '@comapeo/core'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BEARER_TOKEN,
  createTestServer,
  generateObservation,
  generatePreset,
  generateTrack,
  getManagerOptions,
  randomAddProjectBody,
  randomProjectPublicId,
  runWithRetries,
} from './test-helpers.js'

/** @import {Static} from '@sinclair/typebox' */
/** @import {Preset} from '../src/datatypes/preset.js' */
/** @import {Observation} from '../src/datatypes/observation.js' */
/** @import {Track} from '../src/datatypes/track.js' */

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

test('fetch presetRef in observation', async (t) => {
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

  // Get a preset for the observation without any fields in it
  const observationPreset = presets.filter(
    ({ geometry, fieldRefs }) =>
      !fieldRefs?.length && geometry.length === 1 && geometry[0] === 'point',
  )[0]

  assert(observationPreset)

  const observation = await project.observation.create({
    ...generateObservation(),
    presetRef: {
      docId: observationPreset.docId,
      versionId: observationPreset.versionId,
    },
  })

  await project.$sync.waitForSync('full')

  const gotObservation = /** @type {Static<Observation>}*/ (
    await runWithRetries(3, async () => {
      const response = await server.inject({
        authority: serverUrl.host,
        method: 'GET',
        url: `/projects/${projectId}/observation/${observation.docId}`,
        headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
      })
      assert.equal(response.statusCode, 200)

      const { data } = await response.json()
      return data
    })
  )

  assert.equal(
    gotObservation.presetRef?.docId,
    observationPreset.docId,
    'observation references preset',
  )

  const presetResponse = await server.inject({
    method: 'GET',
    url: gotObservation.presetRef.url,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(
    presetResponse.statusCode,
    200,
    'able to fetch preset from ref URL',
  )

  // The ref fields won't match so lets ignore them
  const {
    data: { iconRef: _, ...fetchedPreset },
  } = await presetResponse.json()

  const { forks: _2, iconRef: _3, ...expectedPreset } = observationPreset

  assert.deepEqual(fetchedPreset, expectedPreset, 'fetched preset matches')
})

test('fetch presetRef in track', async (t) => {
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

  // Get a preset for the observation without any fields in it
  const trackPreset = presets.filter(
    ({ geometry, fieldRefs }) =>
      !fieldRefs?.length && geometry.length === 1 && geometry[0] === 'line',
  )[0]

  assert(trackPreset)

  const track = await project.track.create({
    ...generateTrack(),
    presetRef: {
      docId: trackPreset.docId,
      versionId: trackPreset.versionId,
    },
  })

  await project.$sync.waitForSync('full')

  const gotTrack = /** @type {Static<Track>}*/ (
    await runWithRetries(3, async () => {
      const response = await server.inject({
        authority: serverUrl.host,
        method: 'GET',
        url: `/projects/${projectId}/track/${track.docId}`,
        headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
      })
      assert.equal(response.statusCode, 200)

      const { data } = await response.json()
      return data
    })
  )

  assert.equal(
    gotTrack.presetRef?.docId,
    trackPreset.docId,
    'track references preset',
  )

  const presetResponse = await server.inject({
    method: 'GET',
    url: gotTrack.presetRef.url,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(
    presetResponse.statusCode,
    200,
    'able to fetch preset from ref URL',
  )

  // The ref fields won't match so lets ignore them
  const {
    data: { iconRef: _, ...fetchedPreset },
  } = await presetResponse.json()

  const { forks: _2, iconRef: _3, ...expectedPreset } = trackPreset

  assert.deepEqual(
    fetchedPreset,
    cleanUndefinedFields(expectedPreset),
    'fetched preset matches',
  )
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
  const gotPresets = /** @type {Static<Preset>[]}*/ (
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
    assert.deepEqual(
      generalData,
      cleanUndefinedFields(expectedData),
      'general preset fields match',
    )

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

/**
 * @template {Record<string, any>} T
 * @param {T} value
 * @returns {T}
 */
function cleanUndefinedFields(value) {
  for (const key of Object.keys(value)) {
    // eslint-disable-next-line no-undefined
    if (value[key] === undefined) {
      delete value[key]
    }
  }
  return value
}
