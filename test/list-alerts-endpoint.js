import { MapeoManager } from '@comapeo/core'
import { valueOf } from '@comapeo/schema'
import { isValidDateTime } from '@garbee/iso8601'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BEARER_TOKEN,
  createTestServer,
  generateAlert,
  generateAlerts,
  getManagerOptions,
  randomAddProjectBody,
  randomProjectPublicId,
} from './test-helpers.js'

/** @import { FastifyInstance } from 'fastify' */

test('returns a 401 if no auth is provided', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
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
    method: 'GET',
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

test('returns a 404 if trying to list alerts from a non-existent project', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
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

test.only('adding alerts', async (t) => {
  const server = createTestServer(t)

  const serverAddress = await server.listen()

  const manager = new MapeoManager(getManagerOptions())
  const projectId = await manager.createProject({ name: 'CoMapeo project' })
  const project = await manager.getProject(projectId)

  await project.$member.addServerPeer(serverAddress, {
    dangerouslyAllowInsecureConnections: true,
  })

  project.$sync.start()
  project.$sync.connectServers()
  await project.$sync.waitForSync('full')
  const count = 100

  const generatedAlerts = generateAlerts(count)

  await Promise.all(
    generatedAlerts.map(async (alert) => {
      const response = await server.inject({
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

  const response = await server.inject({
    method: 'GET',
    url: `/projects/${projectId}/remoteDetectionAlerts`,
    headers: {
      Authorization: 'Bearer ' + BEARER_TOKEN,
    },
  })

  const alertsValues = response.json().data.map(valueOf)

  assert.equal(alertsValues.length, count)

  assert.deepEqual(
    new Set(alertsValues.map(normalizeISODateStrings)),
    new Set(generatedAlerts.map(normalizeISODateStrings)),
  )
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
 * @template {Record<string, any>} T
 * @param {T} obj
 * @returns {T}
 */
function normalizeISODateStrings(obj) {
  /** @type {any} */
  const normalized = {}
  for (const key in normalized) {
    if (typeof obj[key] === 'string' && isValidDateTime(obj[key])) {
      normalized[key] = new Date(obj[key]).toISOString()
    } else if (obj[key] === null || typeof obj[key] !== 'object') {
      normalized[key] = obj[key]
    } else if (Array.isArray(obj[key])) {
      normalized[key] = obj[key].map(normalizeISODateStrings)
    } else {
      normalized[key] = normalizeISODateStrings(obj[key])
    }
  }
  return normalized
}
