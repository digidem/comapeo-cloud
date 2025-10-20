import { replicateProject } from '@comapeo/core'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'
import { Type } from '@sinclair/typebox'
import timingSafeEqual from 'string-timing-safe-equal'

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { STATUS_CODES } from 'node:http'

import { Field as fieldSchema } from './datatypes/field.js'
import { Observation as observationSchema } from './datatypes/observation.js'
import { Preset as presetSchema } from './datatypes/preset.js'
import { Track as trackSchema } from './datatypes/track.js'
import * as errors from './errors.js'
import * as schemas from './schemas.js'
import { wsCoreReplicator } from './ws-core-replicator.js'

/** @import { FastifyInstance, FastifyPluginAsync, FastifyRequest, RawServerDefault } from 'fastify' */
/** @import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox' */
/** @import { MapeoDoc } from '@comapeo/schema' */
/** @import { MapeoProject } from '@comapeo/core/dist/mapeo-project.js' */
/** @import {Static, TSchema} from '@sinclair/typebox' */

/**
 * @template {MapeoDoc['schemaName']} TSchemaName
 * @typedef {Extract<MapeoDoc, { schemaName: TSchemaName }>} GetMapeoDoc
 */

/**
 * @typedef {{baseUrl: URL, projectPublicId: string, project: MapeoProject}} MapDocParam
 */

/**
 * @typedef {{docId: string, versionId: string}} Ref
 */

/**
 * @typedef {{docId: string, versionId: string, url: string}} UrlRef
 */

const BEARER_SPACE_LENGTH = 'Bearer '.length

const BASE32_REGEX_32_BYTES = '^[0-9A-Za-z]{52}$'
const BASE32_STRING_32_BYTES = Type.String({ pattern: BASE32_REGEX_32_BYTES })

const INDEX_HTML_PATH = new URL('./static/index.html', import.meta.url)

const SUPPORTED_ATTACHMENT_TYPES = new Set(
  /** @type {const} */ (['photo', 'audio']),
)

/**
 * @typedef {object} RouteOptions
 * @prop {string} serverBearerToken
 * @prop {string} serverName
 * @prop {undefined | number | string[]} [allowedProjects=1]
 */

/** @type {FastifyPluginAsync<RouteOptions, RawServerDefault, TypeBoxTypeProvider>} */
export default async function routes(
  fastify,
  { serverBearerToken, serverName, allowedProjects = 1 },
) {
  /** @type {Set<string> | number} */
  const allowedProjectsSetOrNumber = Array.isArray(allowedProjects)
    ? new Set(allowedProjects)
    : allowedProjects

  /**
   * @param {FastifyRequest} req
   */
  const verifyBearerAuth = (req) => {
    if (!isBearerTokenValid(req.headers.authorization, serverBearerToken)) {
      throw errors.invalidBearerToken()
    }
  }

  fastify.setErrorHandler((error, _req, reply) => {
    /** @type {number} */
    let statusCode = error.statusCode || 500
    if (
      !Number.isInteger(statusCode) ||
      statusCode < 400 ||
      statusCode >= 600
    ) {
      statusCode = 500
    }

    const code = errors.normalizeCode(
      typeof error.code === 'string'
        ? error.code
        : STATUS_CODES[statusCode] || 'ERROR',
    )

    const { message = 'Server error' } = error

    reply.status(statusCode).send({ error: { code, message } })
  })

  fastify.get('/', (_req, reply) => {
    const stream = fs.createReadStream(INDEX_HTML_PATH)
    reply.header('Content-Type', 'text/html')
    reply.send(stream)
  })

  fastify.get(
    '/info',
    {
      schema: {
        response: {
          200: Type.Object({
            data: Type.Object({
              deviceId: Type.String(),
              name: Type.String(),
            }),
          }),
        },
      },
    },
    /**
     * @this {FastifyInstance}
     */
    function () {
      const { deviceId, name } = this.comapeo.getDeviceInfo()
      return {
        data: { deviceId, name: name || serverName },
      }
    },
  )

  fastify.get(
    '/projects',
    {
      schema: {
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                projectId: Type.String(),
                name: Type.Optional(Type.String()),
              }),
            ),
          }),
          '4xx': schemas.errorResponse,
        },
      },
      async preHandler(req) {
        verifyBearerAuth(req)
      },
    },
    /**
     * @this {FastifyInstance}
     */
    async function () {
      const projects = await this.comapeo.listProjects()
      return {
        data: projects.map((project) => ({
          projectId: project.projectId,
          name: project.name,
        })),
      }
    },
  )

  fastify.put(
    '/projects',
    {
      schema: {
        body: schemas.projectToAdd,
        response: {
          200: Type.Object({
            data: Type.Object({
              deviceId: schemas.HEX_STRING_32_BYTES,
            }),
          }),
          400: schemas.errorResponse,
        },
      },
    },
    /**
     * @this {FastifyInstance}
     */
    async function (req) {
      const { projectName } = req.body
      const projectKey = Buffer.from(req.body.projectKey, 'hex')
      const projectPublicId = projectKeyToPublicId(projectKey)

      const existingProjects = await this.comapeo.listProjects()

      // This assumes that two projects with the same project key are equivalent,
      // and that we don't need to add more. Theoretically, someone could add
      // project with ID 1 and keys A, then add project with ID 1 and keys B.
      // This would mean a malicious/buggy client, which could cause errors if
      // trying to sync with this server--that seems acceptable.
      const alreadyHasThisProject = existingProjects.some((p) =>
        // We don't want people to be able to enumerate the project keys that
        // this server has.
        timingSafeEqual(p.projectId, projectPublicId),
      )

      if (!alreadyHasThisProject) {
        if (
          allowedProjectsSetOrNumber instanceof Set &&
          !allowedProjectsSetOrNumber.has(projectPublicId)
        ) {
          throw errors.projectNotInAllowlist()
        }

        if (
          typeof allowedProjectsSetOrNumber === 'number' &&
          existingProjects.length >= allowedProjectsSetOrNumber
        ) {
          throw errors.tooManyProjects()
        }
      }

      const baseUrl = req.baseUrl.toString()

      const existingDeviceInfo = this.comapeo.getDeviceInfo()
      // We don't set device info until this point. We trust that `req.hostname`
      // is the hostname we want clients to use to sync to the server.
      if (
        existingDeviceInfo.deviceType === 'device_type_unspecified' ||
        existingDeviceInfo.selfHostedServerDetails?.baseUrl !== baseUrl
      ) {
        await this.comapeo.setDeviceInfo({
          deviceType: 'selfHostedServer',
          name: serverName,
          selfHostedServerDetails: { baseUrl },
        })
      }

      if (!alreadyHasThisProject) {
        const projectId = await this.comapeo.addProject(
          {
            projectKey,
            projectName,
            encryptionKeys: {
              auth: Buffer.from(req.body.encryptionKeys.auth, 'hex'),
              config: Buffer.from(req.body.encryptionKeys.config, 'hex'),
              data: Buffer.from(req.body.encryptionKeys.data, 'hex'),
              blobIndex: Buffer.from(req.body.encryptionKeys.blobIndex, 'hex'),
              blob: Buffer.from(req.body.encryptionKeys.blob, 'hex'),
            },
          },
          { waitForSync: false },
        )
        assert.equal(
          projectId,
          projectPublicId,
          'adding a project should return the same ID as what was passed',
        )
      }

      const project = await this.comapeo.getProject(projectPublicId)
      project.$sync.start()

      return {
        data: {
          deviceId: this.comapeo.deviceId,
        },
      }
    },
  )

  fastify.get(
    '/sync/:projectPublicId',
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
        }),
        response: {
          '4xx': schemas.errorResponse,
        },
      },
      async preHandler(req) {
        await ensureProjectExists(this, req)
      },
      websocket: true,
    },
    /**
     * @this {FastifyInstance}
     */
    async function (socket, req) {
      // The preValidation hook ensures that the project exists
      const project = await this.comapeo.getProject(req.params.projectPublicId)
      const replicationStream = replicateProject(project, false)
      wsCoreReplicator(socket, replicationStream)
      project.$sync.start()
    },
  )

  addDatatypeGetter('observation', observationSchema, setAttachmentURL)
  // TODO: backwards compat, remove this in next major release
  addDatatypeGetter(
    'observation',
    observationSchema,
    setAttachmentURL,
    'observations',
  )
  addDatatypeGetter('track', trackSchema, (track, { projectPublicId }) => ({
    ...track,
    presetRef: expandRef(track.presetRef, 'preset', projectPublicId),
    observationRefs: expandManyRefs(
      track.observationRefs,
      'observation',
      projectPublicId,
    ),
  }))
  addDatatypeGetter('preset', presetSchema, (preset, { projectPublicId }) => ({
    ...preset,
    fieldRefs: expandManyRefs(preset.fieldRefs, 'field', projectPublicId),
    iconRef: expandRef(preset.iconRef, 'icon', projectPublicId),
  }))
  addDatatypeGetter('field', fieldSchema, (field) => field)

  fastify.get(
    '/projects/:projectPublicId/remoteDetectionAlerts',
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
        }),
        response: {
          200: Type.Object({
            data: Type.Array(schemas.remoteDetectionAlertResult),
          }),
          '4xx': schemas.errorResponse,
        },
      },
      async preHandler(req) {
        verifyBearerAuth(req)
        await ensureProjectExists(this, req)
      },
    },
    /**
     * @this {FastifyInstance}
     */
    async function (req) {
      const { projectPublicId } = req.params
      const project = await this.comapeo.getProject(projectPublicId)

      return {
        data: (
          await project.remoteDetectionAlert.getMany({ includeDeleted: true })
        ).map((alert) => ({
          docId: alert.docId,
          createdAt: alert.createdAt,
          updatedAt: alert.updatedAt,
          deleted: alert.deleted,
          detectionDateStart: alert.detectionDateStart,
          detectionDateEnd: alert.detectionDateEnd,
          sourceId: alert.sourceId,
          metadata: alert.metadata,
          geometry: alert.geometry,
        })),
      }
    },
  )

  fastify.post(
    '/projects/:projectPublicId/remoteDetectionAlerts',
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
        }),
        body: schemas.remoteDetectionAlertToAdd,
        response: {
          201: Type.Literal(''),
          '4xx': schemas.errorResponse,
        },
      },
      async preHandler(req) {
        verifyBearerAuth(req)
        await ensureProjectExists(this, req)
      },
    },
    /**
     * @this {FastifyInstance}
     */
    async function (req, reply) {
      const { projectPublicId } = req.params
      const project = await this.comapeo.getProject(projectPublicId)

      await project.remoteDetectionAlert.create({
        schemaName: 'remoteDetectionAlert',
        ...req.body,
      })

      reply.status(201).send()
    },
  )

  fastify.get(
    `/projects/:projectPublicId/icon/:docId`,
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
          docId: BASE32_STRING_32_BYTES,
        }),
        querystring: Type.Object({
          variant: Type.Optional(
            Type.Union([
              Type.Literal('small'),
              Type.Literal('medium'),
              Type.Literal('large'),
            ]),
          ),
        }),
        response: {
          200: {},
          '4xx': schemas.errorResponse,
        },
      },
      async preHandler(req) {
        verifyBearerAuth(req)
        await ensureProjectExists(this, req)
      },
    },
    /**
     * @this {FastifyInstance}
     */
    async function (req, reply) {
      const { projectPublicId, docId } = req.params
      const variant = req.query.variant ?? 'medium'
      const project = await this.comapeo.getProject(projectPublicId)
      const iconUrl = await project.$icons.getIconUrl(docId, {
        mimeType: 'image/svg+xml',
        size: variant,
      })

      const proxiedResponse = await fetch(iconUrl)
      reply.code(proxiedResponse.status)
      for (const [headerName, headerValue] of proxiedResponse.headers) {
        reply.header(headerName, headerValue)
      }
      return reply.send(proxiedResponse.body)
    },
  )

  fastify.get(
    '/projects/:projectPublicId/attachments/:driveDiscoveryId/:type/:name',
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
          driveDiscoveryId: Type.String(),
          type: Type.Union(
            [...SUPPORTED_ATTACHMENT_TYPES].map((attachmentType) =>
              Type.Literal(attachmentType),
            ),
          ),
          name: Type.String(),
        }),
        querystring: Type.Object({
          variant: Type.Optional(
            // Not all of these are valid for all attachment types.
            // For example, you can't get an audio's thumbnail.
            // We do additional checking later to verify validity.
            Type.Union([
              Type.Literal('original'),
              Type.Literal('preview'),
              Type.Literal('thumbnail'),
            ]),
          ),
        }),
        response: {
          200: {},
          '4xx': schemas.errorResponse,
        },
      },
      async preHandler(req) {
        verifyBearerAuth(req)
        await ensureProjectExists(this, req)
      },
    },
    /**
     * @this {FastifyInstance}
     */
    async function (req, reply) {
      const project = await this.comapeo.getProject(req.params.projectPublicId)

      let typeAndVariant
      switch (req.params.type) {
        case 'photo':
          typeAndVariant = {
            type: /** @type {const} */ ('photo'),
            variant: req.query.variant || 'original',
          }
          break
        case 'audio':
          if (req.query.variant && req.query.variant !== 'original') {
            throw errors.badRequestError(
              'Cannot fetch this variant for audio attachments',
            )
          }
          typeAndVariant = {
            type: /** @type {const} */ ('audio'),
            variant: /** @type {const} */ ('original'),
          }
          break
        default:
          throw errors.shouldBeImpossibleError(req.params.type)
      }

      const blobUrl = await project.$blobs.getUrl({
        driveId: req.params.driveDiscoveryId,
        name: req.params.name,
        ...typeAndVariant,
      })

      const proxiedResponse = await fetch(blobUrl)
      reply.code(proxiedResponse.status)
      for (const [headerName, headerValue] of proxiedResponse.headers) {
        reply.header(headerName, headerValue)
      }
      return reply.send(proxiedResponse.body)
    },
  )

  /**
   * @template {import('@sinclair/typebox').TSchema} TSchema
   * @template {"track"|"observation"|"preset"|"field"} TDataType
   * @param {TDataType} dataType - DataType to pull from
   * @param {TSchema} responseSchema - Schema for the response data
   * @param {(doc: GetMapeoDoc<TDataType>, req: MapDocParam) => Static<TSchema>|Promise<TSchema>} mapDoc - Add / remove fields
   * @param {string} [typeRoute] - Route to mount the getters under. Defaults to the dataType
   */
  function addDatatypeGetter(
    dataType,
    responseSchema,
    mapDoc,
    typeRoute = dataType,
  ) {
    fastify.get(
      `/projects/:projectPublicId/${typeRoute}`,
      {
        schema: {
          params: Type.Object({
            projectPublicId: BASE32_STRING_32_BYTES,
          }),
          response: {
            200: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: responseSchema,
                },
              },
            },
            '4xx': schemas.errorResponse,
          },
        },
        async preHandler(req) {
          verifyBearerAuth(req)
          await ensureProjectExists(this, req)
        },
      },
      /**
       * @this {FastifyInstance}
       */
      async function (req) {
        const { projectPublicId } = req.params
        const project = await this.comapeo.getProject(projectPublicId)

        const datatype = project[dataType]

        const data = await Promise.all(
          (await datatype.getMany({ includeDeleted: true })).map((doc) =>
            mapDoc(/** @type {GetMapeoDoc<TDataType>}*/ (doc), {
              projectPublicId,
              project,
              baseUrl: req.baseUrl,
            }),
          ),
        )

        return { data }
      },
    )

    fastify.get(
      `/projects/:projectPublicId/${typeRoute}/:docId`,
      {
        schema: {
          params: Type.Object({
            projectPublicId: BASE32_STRING_32_BYTES,
            docId: BASE32_STRING_32_BYTES,
          }),
          response: {
            200: {
              type: 'object',
              properties: {
                data: responseSchema,
              },
            },
            '4xx': schemas.errorResponse,
          },
        },
        async preHandler(req) {
          verifyBearerAuth(req)
          await ensureProjectExists(this, req)
        },
      },
      /**
       * @this {FastifyInstance}
       */
      async function (req) {
        const { projectPublicId, docId } = req.params
        const project = await this.comapeo.getProject(projectPublicId)

        const datatype = project[dataType]

        const rawData = await datatype.getByDocId(docId)

        const data = await mapDoc(
          /** @type {GetMapeoDoc<TDataType>}*/ (rawData),
          {
            projectPublicId,
            project,
            baseUrl: req.baseUrl,
          },
        )

        return { data }
      },
    )
  }
}

/**
 * @param {Ref | undefined} ref
 * @param {string} dataType
 * @param {string} projectPublicId
 * @returns {UrlRef | undefined}
 */
function expandRef(ref, dataType, projectPublicId) {
  if (!ref) return ref
  return {
    ...ref,
    url: `projects/${projectPublicId}/${dataType}/${ref.docId}`,
  }
}

/**
 * @param {Ref[] | undefined} refs
 * @param {string} dataType
 * @param {string} projectPublicId
 * @returns {UrlRef[]}
 */
function expandManyRefs(refs, dataType, projectPublicId) {
  if (!refs) return []
  return refs.map((ref) => ({
    ...ref,
    url: `projects/${projectPublicId}/${dataType}/${ref.docId}`,
  }))
}

/**
 *
 * @param {GetMapeoDoc<"observation">} obs
 * @param {*} param1
 * @returns {Static<observationSchema>}
 */
function setAttachmentURL(obs, { projectPublicId, baseUrl }) {
  return {
    ...obs,
    attachments: obs.attachments
      .filter((attachment) =>
        SUPPORTED_ATTACHMENT_TYPES.has(/** @type {any} */ (attachment.type)),
      )
      .map((attachment) => ({
        url: new URL(
          `projects/${projectPublicId}/attachments/${attachment.driveDiscoveryId}/${attachment.type}/${attachment.name}`,
          baseUrl,
        ).href,
      })),
    presetRef: expandRef(obs.presetRef, 'preset', projectPublicId),
  }
}

/**
 * @param {undefined | string} headerValue
 * @param {string} expectedBearerToken
 * @returns {boolean}
 */
function isBearerTokenValid(headerValue = '', expectedBearerToken) {
  // This check is not strictly required for correctness, but helps protect
  // against long values.
  const expectedLength = BEARER_SPACE_LENGTH + expectedBearerToken.length
  if (headerValue.length !== expectedLength) return false

  if (!headerValue.startsWith('Bearer ')) return false
  const actualBearerToken = headerValue.slice(BEARER_SPACE_LENGTH)

  return timingSafeEqual(actualBearerToken, expectedBearerToken)
}

/**
 * @param {FastifyInstance} fastify
 * @param {object} req
 * @param {object} req.params
 * @param {string} req.params.projectPublicId
 * @returns {Promise<void>}
 */
async function ensureProjectExists(fastify, req) {
  try {
    await fastify.comapeo.getProject(req.params.projectPublicId)
  } catch (e) {
    if (e instanceof Error && e.constructor.name === 'NotFoundError') {
      throw errors.projectNotFoundError()
    }
    throw e
  }
}
