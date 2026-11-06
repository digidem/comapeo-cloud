import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'
import { WebSocket } from 'ws'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

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

test('sync endpoint closes a client that goes silent', async (t) => {
  const timeoutMs = 300
  const server = createTestServer(t, { syncInactivityTimeoutMs: timeoutMs })
  const addProjectBody = randomAddProjectBody()
  const projectPublicId = projectKeyToPublicId(
    Buffer.from(addProjectBody.projectKey, 'hex'),
  )
  await server.inject({ method: 'PUT', url: '/projects', body: addProjectBody })

  const serverAddress = await server.listen()
  const url = serverAddress.replace(/^http/u, 'ws') + '/sync/' + projectPublicId

  const silentClient = new WebSocket(url)
  const chattyClient = new WebSocket(url)
  t.after(() => {
    silentClient.terminate()
    chattyClient.terminate()
  })
  await Promise.all([once(silentClient, 'open'), once(chattyClient, 'open')])

  // Empty frames count as inbound messages but never reach the replication
  // stream, so the noise handshake does not fail on junk
  const sender = setInterval(() => chattyClient.send(Buffer.alloc(0)), 50)
  t.after(() => clearInterval(sender))

  await once(silentClient, 'close', { signal: AbortSignal.timeout(3000) })
  await delay(timeoutMs * 2)
  assert.equal(chattyClient.readyState, WebSocket.OPEN)
})
