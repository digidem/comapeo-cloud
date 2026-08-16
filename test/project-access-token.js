import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import {
  createProjectAccessToken,
  decodeProjectTokenKey,
  verifyProjectAccessToken,
} from '../src/project-access-token.js'

const PROJECT_ID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJK'

test('project access token round trip', () => {
  const key = randomBytes(32)
  const credential = createProjectAccessToken(key, PROJECT_ID)

  assert.match(credential, /^cpat1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
  assert.equal(verifyProjectAccessToken(key, credential), PROJECT_ID)
})

test('project access tokens contain a fresh nonce', () => {
  const key = randomBytes(32)
  const first = createProjectAccessToken(key, PROJECT_ID)
  const second = createProjectAccessToken(key, PROJECT_ID)

  assert.notEqual(first, second)
  assert.equal(verifyProjectAccessToken(key, first), PROJECT_ID)
  assert.equal(verifyProjectAccessToken(key, second), PROJECT_ID)
})

test('tampered project access tokens fail verification', () => {
  const key = randomBytes(32)
  const credential = createProjectAccessToken(key, PROJECT_ID)
  const [prefix, payload, signature] = credential.split('.')
  assert(prefix && payload && signature)

  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}`
  const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`

  assert.equal(
    verifyProjectAccessToken(key, `${prefix}.${tamperedPayload}.${signature}`),
    null,
  )
  assert.equal(
    verifyProjectAccessToken(key, `${prefix}.${payload}.${tamperedSignature}`),
    null,
  )
  assert.equal(
    verifyProjectAccessToken(key, `cpat2.${payload}.${signature}`),
    null,
  )
  assert.equal(verifyProjectAccessToken(key, 'not-a-project-token'), null)
})

test('rotating the signing key invalidates previously issued tokens', () => {
  const originalKey = randomBytes(32)
  const rotatedKey = randomBytes(32)
  const credential = createProjectAccessToken(originalKey, PROJECT_ID)

  assert.equal(verifyProjectAccessToken(rotatedKey, credential), null)
})

test('project token env key decoding requires canonical base64 for 32 bytes', () => {
  const key = randomBytes(32)
  const encoded = key.toString('base64')
  assert.deepEqual(decodeProjectTokenKey(encoded), key)

  assert.throws(
    () => decodeProjectTokenKey(randomBytes(31).toString('base64')),
    /32 bytes/u,
  )
  assert.throws(() => decodeProjectTokenKey('not base64'), /32 bytes/u)
  assert.equal(decodeProjectTokenKey(), void 0)
})
