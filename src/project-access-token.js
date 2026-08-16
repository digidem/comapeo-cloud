import crypto from 'node:crypto'

const TOKEN_PREFIX = 'cpat1'
const TOKEN_VERSION = 1

/**
 * @typedef {object} ProjectAccessTokenPayload
 * @prop {1} v
 * @prop {string} projectId
 * @prop {string} nonce
 */

/**
 * @param {Buffer} secret
 * @param {string} projectId
 * @returns {string}
 */
export function createProjectAccessToken(secret, projectId) {
  assertSecret(secret)
  const payload = /** @type {ProjectAccessTokenPayload} */ ({
    v: TOKEN_VERSION,
    projectId,
    nonce: crypto.randomBytes(16).toString('base64url'),
  })
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  )
  const signature = sign(secret, encodedPayload).toString('base64url')
  return `${TOKEN_PREFIX}.${encodedPayload}.${signature}`
}

/**
 * Return the scoped project ID when the token is structurally valid and signed
 * by `secret`. Invalid/tampered tokens intentionally collapse to `null` so the
 * caller can return the same 401 response as any other invalid bearer token.
 *
 * @param {Buffer} secret
 * @param {string} token
 * @returns {string | null}
 */
export function verifyProjectAccessToken(secret, token) {
  assertSecret(secret)
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const encodedPayload = parts[1]
  const encodedSignature = parts[2]
  if (!encodedPayload || !encodedSignature) return null

  let suppliedSignature
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url')
  } catch {
    return null
  }

  const expectedSignature = sign(secret, encodedPayload)
  if (
    suppliedSignature.toString('base64url') !== encodedSignature ||
    suppliedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null
  }

  let payload
  try {
    const rawPayload = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    payload = JSON.parse(rawPayload)
  } catch {
    return null
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.v !== TOKEN_VERSION ||
    typeof payload.projectId !== 'string' ||
    payload.projectId.length === 0 ||
    typeof payload.nonce !== 'string' ||
    payload.nonce.length === 0
  ) {
    return null
  }

  return payload.projectId
}

/**
 * Decode the optional env/config value and enforce exactly 32 random bytes.
 * The base64 round-trip check rejects permissive decoder inputs that are not
 * actually canonical base64 strings.
 *
 * @param {string} [value]
 * @returns {Buffer | undefined}
 */
export function decodeProjectTokenKey(value) {
  if (typeof value === 'undefined') return
  if (value.length === 0) {
    throw new Error(
      'PROJECT_ACCESS_TOKEN_SECRET must be 32 bytes encoded as base64',
    )
  }

  const secret = Buffer.from(value, 'base64')
  const canonical = secret.toString('base64')
  const normalizedInput = value.replace(/\s+/gu, '')
  if (secret.length !== 32 || canonical !== normalizedInput) {
    throw new Error(
      'PROJECT_ACCESS_TOKEN_SECRET must be 32 bytes encoded as base64',
    )
  }
  return secret
}

/** @param {Buffer} secret */
function assertSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length !== 32) {
    throw new TypeError('Project access token secret must be 32 bytes')
  }
}

/**
 * @param {Buffer} secret
 * @param {string} encodedPayload
 */
function sign(secret, encodedPayload) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest()
}
