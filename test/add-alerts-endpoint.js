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

/** @import { RemoteDetectionAlertValue } from '@comapeo/schema'*/
/** @import { FastifyInstance } from 'fastify' */

test('returns a 403 if no auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'POST',
    url: `/projects/${randomProjectPublicId()}/remoteDetectionAlerts`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(generateAlert()),
  })
  assert.equal(response.statusCode, 403)
})

test('returns a 403 if incorrect auth is provided', async (t) => {
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
  assert.equal(response.statusCode, 403)
})

test('returns a 403 if trying to add alerts to a non-existent project', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'POST',
    url: `/projects/${randomProjectPublicId()}/remoteDetectionAlerts`,
    headers: {
      Authorization: 'Bearer bad',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(generateAlert()),
  })
  assert.equal(response.statusCode, 403)
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
    {
      ...generateAlert(),
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [1, 2],
          [3, 4],
        ],
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

  const alert = generateAlert()

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

  project.$sync.start()
  project.$sync.connectServers()

  await project.$sync.waitForSync('full')

  // It's possible that the client thinks it's synced but doesn't know about
  // the server's alert yet, so we try a few times.
  await runWithRetries(3, async () => {
    const alerts = await project.remoteDetectionAlert.getMany()
    const hasOurAlert = alerts.some((a) => a.sourceId === alert.sourceId)
    assert(hasOurAlert, 'alert was added and synced')
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

/**
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const randomNumber = (min, max) => min + Math.random() * (max - min)
const randomLatitude = randomNumber.bind(null, -90, 90)
const randomLongitude = randomNumber.bind(null, -180, 180)

function generateAlert() {
  const remoteDetectionAlertDoc = generate('remoteDetectionAlert')[0]
  assert(remoteDetectionAlertDoc)
  return valueOf({
    ...remoteDetectionAlertDoc,
    geometry: {
      type: 'Point',
      coordinates: [randomLongitude(), randomLatitude()],
    },
  })
}
