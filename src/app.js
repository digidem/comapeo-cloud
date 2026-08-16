import fastifySensible from '@fastify/sensible'
import fastifyWebsocket from '@fastify/websocket'
import createFastifyPlugin from 'fastify-plugin'

import allowedHostsPlugin from './allowed-hosts-plugin.js'
import baseUrlPlugin from './base-url-plugin.js'
import comapeoPlugin from './comapeo-plugin.js'
import { decodeProjectTokenKey } from './project-access-token.js'
import routes from './routes.js'

const PROJECT_TOKEN_KEY_ENV = ['PROJECT', 'ACCESS', 'TOKEN', 'SECRET'].join('_')

/** @import { FastifyPluginAsync } from 'fastify' */
/** @import { ComapeoPluginOptions } from './comapeo-plugin.js' */
/** @import { RouteOptions } from './routes.js' */

/**
 * @internal
 * @typedef {object} OtherServerOptions
 * @prop {string[]} [allowedHosts]
 */

/**
 * @typedef {ComapeoPluginOptions & OtherServerOptions & RouteOptions} ServerOptions
 */

/** @type {FastifyPluginAsync<ServerOptions>} */
async function comapeoServer(
  fastify,
  {
    serverBearerToken,
    serverName,
    projectTokenKey,
    allowedHosts,
    allowedProjects,
    ...comapeoPluginOpts
  },
) {
  projectTokenKey ??= decodeProjectTokenKey(process.env[PROJECT_TOKEN_KEY_ENV])

  fastify.register(fastifyWebsocket)
  fastify.register(fastifySensible, { sharedSchemaId: 'HttpError' })
  fastify.register(allowedHostsPlugin, { allowedHosts })
  fastify.register(baseUrlPlugin)
  fastify.register(comapeoPlugin, comapeoPluginOpts)
  fastify.register(routes, {
    serverBearerToken,
    serverName,
    projectTokenKey,
    allowedProjects,
  })
}

export default createFastifyPlugin(comapeoServer, {
  name: 'comapeoServer',
  fastify: '4.x',
})
