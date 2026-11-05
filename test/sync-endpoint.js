import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'
import { WebSocket } from 'ws'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'

import { createTestServer, randomAddProjectBody } from './test-helpers.js'

test('sync endpoint is available after adding a project', async (t) => {
  const server = createTestServer(t)
  const addProjectBody = randomAddProjectBody()
  const projectPublicId = projectKeyToPublicId(
    Buffer.from(addProjectBody.projectKey, 'hex'),
  )

  await t.test('sync endpoint not available yet', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/sync/' + projectPublicId,
      headers: {
        connection: 'upgrade',
        upgrade: 'websocket',
      },
    })
    assert.equal(response.statusCode, 404)
    assert.equal(response.json().error.code, 'PROJECT_NOT_FOUND')
  })

  await server.inject({
    method: 'PUT',
    url: '/projects',
    body: addProjectBody,
  })

  await t.test('sync endpoint available', async (t) => {
    const ws = await server.injectWS('/sync/' + projectPublicId)
    t.after(() => ws.terminate())
    assert.equal(ws.readyState, ws.OPEN, 'websocket is open')
  })
})

test('sync endpoint returns error with an invalid project public ID', async (t) => {
  const server = createTestServer(t)

  const response = await server.inject({
    method: 'GET',
    url: '/sync/foobidoobi',
    headers: {
      connection: 'upgrade',
      upgrade: 'websocket',
    },
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error.code, 'BAD_REQUEST')
})

test('sync endpoint closes a client that stops answering pings', async (t) => {
  const server = createTestServer(t, {
    syncHeartbeatIntervalMs: 100,
    syncHeartbeatTimeoutMs: 300,
  })
  const addProjectBody = randomAddProjectBody()
  const projectPublicId = projectKeyToPublicId(
    Buffer.from(addProjectBody.projectKey, 'hex'),
  )
  await server.inject({ method: 'PUT', url: '/projects', body: addProjectBody })

  const serverAddress = await server.listen()
  const url = serverAddress.replace(/^http/u, 'ws') + '/sync/' + projectPublicId

  // @ts-expect-error autoPong (ws >= 8.15) is missing from @types/ws
  const deadClient = new WebSocket(url, { autoPong: false })
  const liveClient = new WebSocket(url)
  t.after(() => {
    deadClient.terminate()
    liveClient.terminate()
  })
  await Promise.all([once(deadClient, 'open'), once(liveClient, 'open')])

  await once(deadClient, 'close', { signal: AbortSignal.timeout(3000) })
  assert.equal(liveClient.readyState, WebSocket.OPEN, 'live client stays open')
})
