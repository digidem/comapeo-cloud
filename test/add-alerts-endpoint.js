import { MapeoManager } from '@comapeo/core'
import { valueOf } from '@comapeo/schema'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'
import { generate } from '@mapeo/mock-data'
import { Value } from '@sinclair/typebox/value'

import assert from 'node:assert/strict'
import test from 'node:test'

import { remoteDetectionAlertToAdd } from '../src/schemas.js'
import {
  BEARER_TOKEN,
  createTestServer,
  getManagerOptions,
  omit,
  randomAddProjectBody,
  randomProjectPublicId,
  runWithRetries,
} from './test-helpers.js'

/** @import { FastifyInstance } from 'fastify' */

test('returns a 401 if no auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'POST',
    url: `/projects/${randomProjectPublicId()}/remoteDetectionAlerts`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(generateAlert()),
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('returns a 401 if incorrect auth is provided', async (t) => {
  const server = createTestServer(t)

  const projectPublicId = await addProject(server)

  const response = await server.inject({
    method: 'POST',
    url: `/projects/${projectPublicId}/remoteDetectionAlerts`,
    headers: {
      Authorization: 'Bearer bad',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(generateAlert()),
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('returns a 404 if trying to add alerts to a non-existent project', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'POST',
    url: `/projects/${randomProjectPublicId()}/remoteDetectionAlerts`,
    headers: {
      Authorization: 'Bearer ' + BEARER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(generateAlert()),
  })
  assert.equal(response.statusCode, 404)
  assert.equal(response.json().error.code, 'PROJECT_NOT_FOUND')
})

test('returns a 400 if trying to add invalid alerts', async (t) => {
  const server = createTestServer(t)

  const projectPublicId = await addProject(server)

  const alertKeys = /** @type {const} */ ([
    'detectionDateStart',
    'detectionDateEnd',
    'sourceId',
    'metadata',
    'geometry',
  ])

  const badAlerts = [
    {},
    {
      ...generateAlert(),
      detectionDateStart: 'not a date',
    },
    {
      ...generateAlert(),
      detectionDateEnd: 'not a date',
    },
    {
      ...generateAlert(),
      geometry: {
        type: 'Point',
        coordinates: [-181.01, 0],
      },
    },
    {
      ...generateAlert(),
      geometry: {
        type: 'Point',
        coordinates: [181.01, 0],
      },
    },
    {
      ...generateAlert(),
      geometry: {
        type: 'Point',
        coordinates: [0, -90.01],
      },
    },
    {
      ...generateAlert(),
      geometry: {
        type: 'Point',
        coordinates: [0, 90.01],
      },
    },
    ...alertKeys.flatMap((keyToMessUp) => [
      omit(generateAlert(), keyToMessUp),
      { ...generateAlert(), [keyToMessUp]: null },
    ]),
  ]

  await Promise.all(
    badAlerts.map(async (badAlert) => {
      const body = JSON.stringify(badAlert)
      assert(
        !Value.Check(remoteDetectionAlertToAdd, body),
        `test setup: ${body} should be invalid`,
      )

      const response = await server.inject({
        method: 'POST',
        url: `/projects/${projectPublicId}/remoteDetectionAlerts`,
        headers: {
          Authorization: 'Bearer ' + BEARER_TOKEN,
          'Content-Type': 'application/json',
        },
        body,
      })
      assert.equal(
        response.statusCode,
        400,
        `${body} should be invalid and return a 400`,
      )
      assert.equal(response.json().error.code, 'BAD_REQUEST')
    }),
  )
})

test('adding alerts', async (t) => {
  const server = createTestServer(t)
  const serverAddressPromise = server.listen()

  const manager = new MapeoManager(getManagerOptions())
  const projectId = await manager.createProject({ name: 'CoMapeo project' })
  const project = await manager.getProject(projectId)
  t.after(() => project.close())

  const serverAddress = await serverAddressPromise
  const serverUrl = new URL(serverAddress)
  await project.$member.addServerPeer(serverAddress, {
    dangerouslyAllowInsecureConnections: true,
  })

  const alerts = generateAlerts(100)

  await Promise.all(
    alerts.map(async (alert) => {
      const response = await server.inject({
        authority: serverUrl.host,
        method: 'POST',
        url: `/projects/${projectId}/remoteDetectionAlerts`,
        headers: {
          Authorization: 'Bearer ' + BEARER_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alert),
      })
      assert.equal(response.statusCode, 201)
      assert.equal(response.body, '')
    }),
  )

  project.$sync.start()
  project.$sync.connectServers()

  await project.$sync.waitForSync('full')

  const expectedSourceIds = new Set(alerts.map((a) => a.sourceId))

  // It's possible that the client thinks it's synced but doesn't know about
  // the server's alert yet, so we try a few times.
  await runWithRetries(3, async () => {
    const alerts = await project.remoteDetectionAlert.getMany()
    const actualSourceIds = new Set(alerts.map((a) => a.sourceId))
    assert.deepEqual(
      actualSourceIds,
      expectedSourceIds,
      'alerts were added and synced',
    )
  })
})

/**
 * @param {FastifyInstance} server
 * @returns {Promise<string>} a promise that resolves with the project's public ID
 */
async function addProject(server) {
  const body = randomAddProjectBody()
  const response = await server.inject({
    method: 'PUT',
    url: '/projects',
    body,
  })
  assert.equal(response.statusCode, 200, 'test setup: adding a project')

  const { projectKey } = body
  return projectKeyToPublicId(Buffer.from(projectKey, 'hex'))
}

function generateAlert() {
  const [result] = generateAlerts(1, ['Point'])
  assert(result)
  return result
}

const SUPPORTED_GEOMETRY_TYPES = /** @type {const} */ ([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
])

/**
 * @param {number} count
 * @param {ReadonlyArray<typeof SUPPORTED_GEOMETRY_TYPES[number]>} [geometryTypes]
 */
function generateAlerts(count, geometryTypes = SUPPORTED_GEOMETRY_TYPES) {
  if (count < geometryTypes.length) {
    throw new Error(
      'test setup: count must be at least as large as geometryTypes',
    )
  }
  // Hacky, but should get the job done ensuring we have all geometry types in the test
  const alerts = []
  for (const geometryType of geometryTypes) {
    /** @type {import('@comapeo/schema').RemoteDetectionAlert | undefined} */
    let alert
    while (!alert || alert.geometry.type !== geometryType) {
      ;[alert] = generate('remoteDetectionAlert', { count: 1 })
    }
    alerts.push(alert)
  }
  // eslint-disable-next-line prefer-spread
  alerts.push.apply(
    alerts,
    generate('remoteDetectionAlert', { count: count - alerts.length }),
  )
  return alerts.map((alert) => valueOf(alert))
}
