import { MapeoManager } from '@comapeo/core'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

/** @import { FastifyInstance } from 'fastify' */
import {
  BEARER_TOKEN,
  createTestServer,
  generateAlert,
  generateObservation,
  generatePreset,
  generateTrack,
  getManagerOptions,
  randomAddProjectBody,
  randomHex,
  randomProjectPublicId,
} from './test-helpers.js'

const FIXTURE_IMAGE_ORIGINAL_PATH = new URL(
  './fixtures/original.jpg',
  import.meta.url,
).pathname

/** @param {string} credential */
const bearerHeaders = (credential) => ({
  Authorization: `Bearer ${credential}`,
})

/**
 * @param {FastifyInstance} server
 * @param {ReturnType<typeof randomAddProjectBody>} [body]
 */
async function addProject(server, body = randomAddProjectBody()) {
  const response = await server.inject({
    method: 'PUT',
    url: '/projects',
    body,
  })
  assert.equal(response.statusCode, 200)
  return projectKeyToPublicId(Buffer.from(body.projectKey, 'hex'))
}

/**
 * @param {FastifyInstance} server
 * @param {string} projectId
 * @param {string} [credential]
 */
async function mintProjectCredential(
  server,
  projectId,
  credential = BEARER_TOKEN,
) {
  return server.inject({
    method: 'POST',
    url: `/projects/${projectId}/accessTokens`,
    headers: bearerHeaders(credential),
  })
}

test('project-scoped credentials enforce the REST authorization boundary', async (t) => {
  const projectTokenKey = randomBytes(32)
  const server = createTestServer(t, {
    allowedProjects: 999,
    projectTokenKey,
  })
  const serverAddress = await server.listen()
  const manager = new MapeoManager(getManagerOptions())
  const projectA = await manager.createProject({ name: 'Scoped project' })
  const project = await manager.getProject(projectA)
  await project.$member.addServerPeer(serverAddress, {
    dangerouslyAllowInsecureConnections: true,
  })
  project.$sync.start()
  project.$sync.connectServers()

  const observation = await project.observation.create(generateObservation())
  const track = await project.track.create(generateTrack())
  const presets = await generatePreset(project)
  const preset = presets[0]
  assert(preset)
  const fields = await project.field.getMany()
  const field = fields[0]
  assert(field)
  const imageBlob = await project.$blobs.create(
    { original: FIXTURE_IMAGE_ORIGINAL_PATH },
    { mimeType: 'image/jpeg' },
  )
  await project.$sync.waitForSync('full')

  const projectB = await addProject(server)

  const masterList = await server.inject({
    method: 'GET',
    url: '/projects',
    headers: bearerHeaders(BEARER_TOKEN),
  })
  assert.equal(masterList.statusCode, 200)
  assert.equal(masterList.json().data.length, 2)

  const mintResponse = await mintProjectCredential(server, projectA)
  assert.equal(mintResponse.statusCode, 200)
  const mintData = mintResponse.json().data
  assert.equal(mintData.projectId, projectA)
  assert.match(mintData.token, /^cpat1\./u)
  const scopedCredential = mintData.token

  const scopedList = await server.inject({
    method: 'GET',
    url: '/projects',
    headers: bearerHeaders(scopedCredential),
  })
  assert.equal(scopedList.statusCode, 200)
  assert.deepEqual(
    scopedList
      .json()
      .data.map(
        (/** @type {{projectId: string}} */ project) => project.projectId,
      ),
    [projectA],
  )

  for (const [route, docId] of [
    ['observation', observation.docId],
    ['track', track.docId],
    ['preset', preset.docId],
    ['field', field.docId],
  ]) {
    const listResponse = await server.inject({
      method: 'GET',
      url: `/projects/${projectA}/${route}`,
      headers: bearerHeaders(scopedCredential),
    })
    assert.equal(
      listResponse.statusCode,
      200,
      `${route} list is scoped-accessible`,
    )

    const detailResponse = await server.inject({
      method: 'GET',
      url: `/projects/${projectA}/${route}/${docId}`,
      headers: bearerHeaders(scopedCredential),
    })
    assert.equal(
      detailResponse.statusCode,
      200,
      `${route} detail is scoped-accessible`,
    )
  }

  assert(preset.iconRef)
  const iconResponse = await server.inject({
    method: 'GET',
    url: `/projects/${projectA}/icon/${preset.iconRef.docId}`,
    headers: bearerHeaders(scopedCredential),
  })
  assert.equal(iconResponse.statusCode, 200)

  const attachmentResponse = await server.inject({
    method: 'GET',
    url: `/projects/${projectA}/attachments/${imageBlob.driveId}/photo/${imageBlob.name}`,
    headers: bearerHeaders(scopedCredential),
  })
  assert.equal(attachmentResponse.statusCode, 200)

  const readAlerts = await server.inject({
    method: 'GET',
    url: `/projects/${projectA}/remoteDetectionAlerts`,
    headers: bearerHeaders(scopedCredential),
  })
  assert.equal(readAlerts.statusCode, 200)

  const writeAlert = await server.inject({
    method: 'POST',
    url: `/projects/${projectA}/remoteDetectionAlerts`,
    headers: bearerHeaders(scopedCredential),
    body: generateAlert(),
  })
  assert.equal(writeAlert.statusCode, 201)

  const outOfScopeUrls = [
    `/projects/${projectB}/observation`,
    `/projects/${projectB}/observation/${randomHex()}`,
    `/projects/${projectB}/track`,
    `/projects/${projectB}/track/${randomHex()}`,
    `/projects/${projectB}/preset`,
    `/projects/${projectB}/preset/${randomHex()}`,
    `/projects/${projectB}/field`,
    `/projects/${projectB}/field/${randomHex()}`,
    `/projects/${projectB}/icon/${randomHex()}`,
    `/projects/${projectB}/attachments/unknown/photo/unknown.jpg`,
    `/projects/${projectB}/remoteDetectionAlerts`,
  ]
  for (const url of outOfScopeUrls) {
    const response = await server.inject({
      method: 'GET',
      url,
      headers: bearerHeaders(scopedCredential),
    })
    assert.equal(response.statusCode, 404, `out-of-scope ${url} is hidden`)
    assert.equal(response.json().error.code, 'PROJECT_NOT_FOUND')
  }

  const outOfScopeWrite = await server.inject({
    method: 'POST',
    url: `/projects/${projectB}/remoteDetectionAlerts`,
    headers: bearerHeaders(scopedCredential),
    body: generateAlert(),
  })
  assert.equal(outOfScopeWrite.statusCode, 404)
  assert.equal(outOfScopeWrite.json().error.code, 'PROJECT_NOT_FOUND')

  const nonexistentResponse = await server.inject({
    method: 'GET',
    url: `/projects/${randomProjectPublicId()}/observation`,
    headers: bearerHeaders(scopedCredential),
  })
  assert.equal(nonexistentResponse.statusCode, 404)
  assert.deepEqual(nonexistentResponse.json(), {
    error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
  })

  const remintResponse = await mintProjectCredential(
    server,
    projectA,
    scopedCredential,
  )
  assert.equal(remintResponse.statusCode, 403)
  assert.equal(remintResponse.json().error.code, 'ARCHIVE_CREDENTIAL_REQUIRED')

  const tamperedCredential = `${scopedCredential.slice(0, -1)}${
    scopedCredential.endsWith('A') ? 'B' : 'A'
  }`
  const tamperedResponse = await server.inject({
    method: 'GET',
    url: '/projects',
    headers: bearerHeaders(tamperedCredential),
  })
  assert.equal(tamperedResponse.statusCode, 401)
  assert.equal(tamperedResponse.json().error.code, 'UNAUTHORIZED')
})

test('project token issuance is unavailable when no signing key is configured', async (t) => {
  const server = createTestServer(t, { allowedProjects: 999 })
  const projectId = await addProject(server)

  const response = await mintProjectCredential(server, projectId)
  assert.equal(response.statusCode, 501)
  assert.deepEqual(response.json(), {
    error: {
      code: 'PROJECT_ACCESS_TOKENS_UNAVAILABLE',
      message: 'Project access tokens are not configured on this server',
    },
  })
})

test('a project credential minted under a rotated key is rejected', async (t) => {
  const originalKey = randomBytes(32)
  const originalServer = createTestServer(t, {
    allowedProjects: 999,
    projectTokenKey: originalKey,
  })
  const projectId = await addProject(originalServer)
  const mintResponse = await mintProjectCredential(originalServer, projectId)
  assert.equal(mintResponse.statusCode, 200)
  const oldCredential = mintResponse.json().data.token

  const rotatedServer = createTestServer(t, {
    allowedProjects: 999,
    projectTokenKey: randomBytes(32),
  })
  const response = await rotatedServer.inject({
    method: 'GET',
    url: '/projects',
    headers: bearerHeaders(oldCredential),
  })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})
