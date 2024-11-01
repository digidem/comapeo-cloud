import { replicateProject } from '@comapeo/core'
import { keyToPublicId as projectKeyToPublicId } from '@mapeo/crypto'
import { Type } from '@sinclair/typebox'
import timingSafeEqual from 'string-timing-safe-equal'

import assert from 'node:assert/strict'
import * as fs from 'node:fs'

import { wsCoreReplicator } from './ws-core-replicator.js'

/** @import { FastifyInstance, FastifyPluginAsync, FastifyRequest, RawServerDefault } from 'fastify' */
/** @import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox' */

const BEARER_SPACE_LENGTH = 'Bearer '.length

const HEX_REGEX_32_BYTES = '^[0-9a-fA-F]{64}$'
const HEX_STRING_32_BYTES = Type.String({ pattern: HEX_REGEX_32_BYTES })
const BASE32_REGEX_32_BYTES = '^[0-9A-Za-z]{52}$'
const BASE32_STRING_32_BYTES = Type.String({ pattern: BASE32_REGEX_32_BYTES })

const INDEX_HTML_PATH = new URL('./static/index.html', import.meta.url)

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
      throw fastify.httpErrors.forbidden('Invalid bearer token')
    }
  }

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
          500: { $ref: 'HttpError' },
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
                name: Type.String(),
              }),
            ),
          }),
          403: { $ref: 'HttpError' },
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
        body: Type.Object({
          projectName: Type.String({ minLength: 1 }),
          projectKey: HEX_STRING_32_BYTES,
          encryptionKeys: Type.Object({
            auth: HEX_STRING_32_BYTES,
            config: HEX_STRING_32_BYTES,
            data: HEX_STRING_32_BYTES,
            blobIndex: HEX_STRING_32_BYTES,
            blob: HEX_STRING_32_BYTES,
          }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              deviceId: HEX_STRING_32_BYTES,
            }),
          }),
          400: { $ref: 'HttpError' },
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
          throw fastify.httpErrors.forbidden('Project not allowed')
        }

        if (
          typeof allowedProjectsSetOrNumber === 'number' &&
          existingProjects.length >= allowedProjectsSetOrNumber
        ) {
          throw fastify.httpErrors.forbidden(
            'Server is already linked to the maximum number of projects',
          )
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
          404: { $ref: 'HttpError' },
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

  fastify.get(
    '/projects/:projectPublicId/observations',
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                docId: Type.String(),
                createdAt: Type.String(),
                updatedAt: Type.String(),
                deleted: Type.Boolean(),
                lat: Type.Optional(Type.Number()),
                lon: Type.Optional(Type.Number()),
                attachments: Type.Array(
                  Type.Object({
                    url: Type.String(),
                  }),
                ),
                tags: Type.Record(
                  Type.String(),
                  Type.Union([
                    Type.Boolean(),
                    Type.Number(),
                    Type.String(),
                    Type.Null(),
                    Type.Array(
                      Type.Union([
                        Type.Boolean(),
                        Type.Number(),
                        Type.String(),
                        Type.Null(),
                      ]),
                    ),
                  ]),
                ),
              }),
            ),
          }),
          403: { $ref: 'HttpError' },
          404: { $ref: 'HttpError' },
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
        data: (await project.observation.getMany({ includeDeleted: true })).map(
          (obs) => ({
            docId: obs.docId,
            createdAt: obs.createdAt,
            updatedAt: obs.updatedAt,
            deleted: obs.deleted,
            lat: obs.lat,
            lon: obs.lon,
            attachments: obs.attachments
              // TODO: For now, only photos are supported.
              // See <https://github.com/digidem/comapeo-cloud/issues/25>.
              .filter((attachment) => attachment.type === 'photo')
              .map((attachment) => ({
                url: new URL(
                  `projects/${projectPublicId}/attachments/${attachment.driveDiscoveryId}/${attachment.type}/${attachment.name}`,
                  req.baseUrl,
                ).href,
              })),
            tags: obs.tags,
          }),
        ),
      }
    },
  )

  fastify.get(
    '/projects/:projectPublicId/attachments/:driveDiscoveryId/:type/:name',
    {
      schema: {
        params: Type.Object({
          projectPublicId: BASE32_STRING_32_BYTES,
          driveDiscoveryId: Type.String(),
          // TODO: For now, only photos are supported.
          // See <https://github.com/digidem/comapeo-cloud/issues/25>.
          type: Type.Literal('photo'),
          name: Type.String(),
        }),
        querystring: Type.Object({
          variant: Type.Optional(
            Type.Union([
              Type.Literal('original'),
              Type.Literal('preview'),
              Type.Literal('thumbnail'),
            ]),
          ),
        }),
        response: {
          403: { $ref: 'HttpError' },
          404: { $ref: 'HttpError' },
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

      const blobUrl = await project.$blobs.getUrl({
        driveId: req.params.driveDiscoveryId,
        name: req.params.name,
        type: req.params.type,
        variant: req.query.variant || 'original',
      })

      const proxiedResponse = await fetch(blobUrl)
      reply.code(proxiedResponse.status)
      for (const [headerName, headerValue] of proxiedResponse.headers) {
        reply.header(headerName, headerValue)
      }
      return reply.send(proxiedResponse.body)
    },
  )
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
    if (e instanceof Error && e.message.startsWith('NotFound')) {
      throw fastify.httpErrors.notFound('Project not found')
    }
    throw e
  }
}
