import createFastifyPlugin from 'fastify-plugin'

/** @import { FastifyPluginAsync } from 'fastify' */

/**
 * @internal
 * @typedef {object} AllowedHostsPluginOptions
 * @property {undefined | string[]} [allowedHosts]
 */

/** @type {FastifyPluginAsync<AllowedHostsPluginOptions>} */
const comapeoPlugin = async (fastify, { allowedHosts }) => {
  if (!allowedHosts) return

  const allowedHostsSet = new Set(allowedHosts)
  fastify.addHook('onRequest', async (req) => {
    if (!allowedHostsSet.has(req.hostname)) {
      throw fastify.httpErrors.forbidden('Forbidden')
    }
  })
}

export default createFastifyPlugin(comapeoPlugin, { name: 'allowedHosts' })
