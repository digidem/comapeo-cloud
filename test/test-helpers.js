import { valueOf } from '@comapeo/core/schema.js'
import {
  KeyManager,
  keyToPublicId as projectKeyToPublicId,
} from '@mapeo/crypto'
import { generate } from '@mapeo/mock-data'
import createFastify from 'fastify'
import RAM from 'random-access-memory'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import comapeoServer from '../src/app.js'

/** @import { MapeoManager } from '@comapeo/core' */
/** @import { TestContext } from 'node:test' */
/** @import { FastifyInstance } from 'fastify' */
/** @import { ServerOptions } from '../src/app.js' */
/** @import { MapeoProject } from '@comapeo/core' */

// Test-only internals, not in core's package exports or public types
const { kBlobStore, kCoreManager } = await import(
  new URL('../node_modules/@comapeo/core/src/mapeo-project.js', import.meta.url)
    .href
)

export const BEARER_TOKEN = Buffer.from('swordfish').toString('base64')

const FIXTURES_ROOT = new URL('./fixtures/', import.meta.url)
export const FIXTURE_IMAGE_ORIGINAL_PATH = new URL(
  'original.jpg',
  FIXTURES_ROOT,
).pathname
export const FIXTURE_IMAGE_PREVIEW_PATH = new URL('preview.jpg', FIXTURES_ROOT)
  .pathname
export const FIXTURE_IMAGE_THUMBNAIL_PATH = new URL(
  'thumbnail.jpg',
  FIXTURES_ROOT,
).pathname
export const FIXTURE_AUDIO_PATH = new URL('audio.mp3', FIXTURES_ROOT).pathname

const TEST_SERVER_DEFAULTS = {
  serverName: 'test server',
  serverBearerToken: BEARER_TOKEN,
}

/**
 * @returns {ConstructorParameters<typeof MapeoManager>[0]}
 */
export function getManagerOptions() {
  const comapeoCoreUrl = new URL(
    '../node_modules/@comapeo/core/',
    import.meta.url,
  )
  const projectMigrationsFolder = new URL('./drizzle/project', comapeoCoreUrl)
    .pathname
  const clientMigrationsFolder = new URL('./drizzle/client', comapeoCoreUrl)
    .pathname
  return {
    rootKey: randomBytes(16),
    projectMigrationsFolder,
    clientMigrationsFolder,
    dbFolder: ':memory:',
    coreStorage: () => new RAM(),
    fastify: createFastify(),
  }
}

/**
 * @param {TestContext} t
 * @param {Partial<ServerOptions>} [serverOptions]
 * @returns {FastifyInstance & { deviceId: string }}
 */
export function createTestServer(t, serverOptions) {
  const managerOptions = getManagerOptions()
  const km = new KeyManager(managerOptions.rootKey)
  const server = createFastify({
    maxParamLength: 256,
  })
  server.register(comapeoServer, {
    ...managerOptions,
    ...TEST_SERVER_DEFAULTS,
    ...serverOptions,
  })
  t.after(() => server.close())
  Object.defineProperty(server, 'deviceId', {
    get() {
      return km.getIdentityKeypair().publicKey.toString('hex')
    },
  })
  // @ts-expect-error
  return server
}

export const randomHex = (length = 32) =>
  Buffer.from(randomBytes(length)).toString('hex')

export const randomAddProjectBody = () => ({
  projectName: randomHex(16),
  projectKey: randomHex(),
  encryptionKeys: {
    auth: randomHex(),
    config: randomHex(),
    data: randomHex(),
    blobIndex: randomHex(),
    blob: randomHex(),
  },
})

export const randomProjectPublicId = () => projectKeyToPublicId(randomBytes(32))

/**
 * @template {object} T
 * @template {keyof T} K
 * @param {T} obj
 * @param {K} key
 * @returns {Omit<T, K>}
 */
export function omit(obj, key) {
  const result = { ...obj }
  delete result[key]
  return result
}

/**
 * @template T
 * @param {number} retries
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function runWithRetries(retries, fn) {
  for (let i = 0; i < retries - 1; i++) {
    try {
      return await fn()
    } catch {
      await delay(500)
    }
  }
  return fn()
}

export function generateAlert() {
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
export function generateAlerts(
  count,
  geometryTypes = SUPPORTED_GEOMETRY_TYPES,
) {
  if (count < geometryTypes.length) {
    throw new Error(
      'test setup: count must be at least as large as geometryTypes',
    )
  }
  // Hacky, but should get the job done ensuring we have all geometry types in the test
  const alerts = []
  for (const geometryType of geometryTypes) {
    /** @type {import('@comapeo/core/schema.js').RemoteDetectionAlert | undefined} */
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

/**
 * Import preset from config and return one of them that could be used for tests
 * @param {MapeoProject} project
 * @returns {Promise<ReturnType<MapeoProject["preset"]["getMany"]>>}
 */
export async function generatePreset(project) {
  await project.$importCategories({
    filePath: fileURLToPath(import.meta.resolve('@mapeo/default-config')),
  })

  const presets = await project.preset.getMany()

  assert(presets.length, 'presets got created')

  return presets
}

/**
 * Generate a new observation
 * @returns {import('@comapeo/core/schema.js').ObservationValue}
 */
export function generateObservation() {
  const observationDoc = generate('observation', { count: 1 })[0]
  assert(observationDoc)
  return valueOf(observationDoc)
}

/**
 * Generate a new track
 * @returns {import('@comapeo/core/schema.js').TrackValue}
 */
export function generateTrack() {
  const trackDoc = generate('track', { count: 1 })[0]
  assert(trackDoc)
  return valueOf(trackDoc)
}

/**
 * @param {object} blob
 * @param {string} blob.driveId
 * @param {'photo' | 'audio' | 'video'} blob.type
 * @param {string} blob.name
 * @param {string} blob.hash
 */
export function blobToAttachment(blob) {
  return {
    driveDiscoveryId: blob.driveId,
    type: blob.type,
    name: blob.name,
    hash: blob.hash,
    external: false,
  }
}

/**
 * Create a photo whose original has only its first block, like one caught
 * mid-way through sync
 * @param {TestContext} t
 * @param {MapeoProject} project
 */
export async function createPartialPhotoBlob(t, project) {
  const internals = /** @type {any} */ (project)

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comapeo-cloud-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'original.jpg')
  // Three hypercore blocks (64 KiB each), so a partial blob is possible
  await fs.writeFile(filePath, randomBytes(3 * 64 * 1024))

  const blob = await project.$blobs.create(
    {
      original: filePath,
      preview: FIXTURE_IMAGE_PREVIEW_PATH,
      thumbnail: FIXTURE_IMAGE_THUMBNAIL_PATH,
    },
    { mimeType: 'image/jpeg' },
  )
  const entry = await internals[kBlobStore].entry({
    driveId: blob.driveId,
    type: 'photo',
    variant: 'original',
    name: blob.name,
  })
  assert(entry, 'test setup: blob entry exists')
  const { blockOffset, blockLength } = entry.value.blob
  await internals[kCoreManager]
    .getWriterCore('blob')
    .core.clear(blockOffset + 1, blockOffset + blockLength)

  return blob
}
