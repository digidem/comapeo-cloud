import { MapeoManager } from '@comapeo/core'
import { valueOf } from '@comapeo/schema'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'
import { generate } from '@mapeo/mock-data'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BEARER_TOKEN,
  createTestServer,
  getManagerOptions,
  randomAddProjectBody,
  randomProjectPublicId,
  runWithRetries,
} from './test-helpers.js'

/** @import {Static} from '@sinclair/typebox' */
/** @import {Track} from '../src/datatypes/track.js' */

test('returns a 401 if no auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${randomProjectPublicId()}/track`,
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('returns a 401 if incorrect auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${randomProjectPublicId()}/track`,
    headers: { Authorization: 'Bearer bad' },
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('returning no tracks', async (t) => {
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
    url: `/projects/${projectPublicId}/track`,
    headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(await response.json(), { data: [] })
})

test('returning tracks with fetchable observations', async (t) => {
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

  const observations = await Promise.all(
    generate('observation', { count: 4 })
      .filter((observation) => observation)
      .map((observation) => ({ ...valueOf(observation), attachments: [] }))
      .map((observation) => project.observation.create(observation)),
  )

  const [o1, o2, o3, o4] = observations.map(({ docId, versionId }) => ({
    docId,
    versionId,
  }))

  assert(o1)
  assert(o2)
  assert(o3)
  assert(o4)

  const tracks = await Promise.all([
    project.track.create(makeTrack([o1, o2])),
    project.track.create(makeTrack([o3, o4])),
  ])

  await project.$sync.waitForSync('full')

  // It's possible that the client thinks it's synced but the server hasn't
  // processed everything yet, so we try a few times.
  const gotTracks = /** @type {Static<Track>[]}*/ (
    await runWithRetries(3, async () => {
      const response = await server.inject({
        authority: serverUrl.host,
        method: 'GET',
        url: `/projects/${projectId}/track`,
        headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
      })
      assert.equal(response.statusCode, 200)

      const { data } = await response.json()
      assert.equal(data.length, 2)
      return data
    })
  )

  for (const track of tracks) {
    const found = gotTracks.find(({ docId }) => docId === track.docId)
    assert(found, 'track got returned')
    const { observationRefs, ...generalData } = found
    const {
      observationRefs: _,
      // Remove irrelevant fields
      presetRef: _2,
      forks: _3,
      ...expectedData
    } = track
    assert.deepEqual(generalData, expectedData, 'general track fields match')
    assert(observationRefs, 'track has observationRefs')
    assert(observationRefs[0]?.url, 'refs have url')

    const observationResponse = await server.inject({
      method: 'GET',
      url: new URL(observationRefs[0].url).pathname,
      headers: { Authorization: 'Bearer ' + BEARER_TOKEN },
    })
    assert.equal(
      observationResponse.statusCode,
      200,
      'able to fetch observation from ref URL',
    )

    const { data: fetchedObservation } = await observationResponse.json()
    assert.equal(fetchedObservation.schemaName, 'observation')
  }
})

/**
 *
 * @param {{docId: string, versionId: string}[]} observationRefs
 * @returns {import('@comapeo/schema').TrackValue}
 */
function makeTrack(observationRefs) {
  const rawTrack = generate('track', { count: 1 })[0]
  delete rawTrack?.presetRef
  assert(rawTrack)
  return {
    ...valueOf(rawTrack),
    observationRefs,
  }
}
