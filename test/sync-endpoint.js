import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import { setImmediate as nextLoop } from 'node:timers/promises'

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

test('server survives a sync client sending garbage instead of a handshake', async (t) => {
  const server = createTestServer(t)
  const addProjectBody = randomAddProjectBody()
  const projectPublicId = projectKeyToPublicId(
    Buffer.from(addProjectBody.projectKey, 'hex'),
  )
  await server.inject({ method: 'PUT', url: '/projects', body: addProjectBody })

  /** @type {unknown[]} */
  const unhandledRejections = []
  /** @param {unknown} err */
  const onUnhandledRejection = (err) => unhandledRejections.push(err)
  process.on('unhandledRejection', onUnhandledRejection)
  t.after(() => process.off('unhandledRejection', onUnhandledRejection))

  const ws = await server.injectWS('/sync/' + projectPublicId)
  // 3-byte frame length prefix followed by a garbage handshake message. An
  // unframed payload would just be buffered while the server waits for more.
  const garbage = Buffer.concat([Buffer.from([64, 0, 0]), randomBytes(64)])
  // The handler drops frames that arrive before it has attached the pipeline.
  const sending = setInterval(() => ws.send(garbage), 10)
  await once(ws, 'close')
  clearInterval(sending)
  await nextLoop()

  assert.deepEqual(unhandledRejections, [])
  const response = await server.inject({ method: 'GET', url: '/info' })
  assert.equal(response.statusCode, 200)
})
