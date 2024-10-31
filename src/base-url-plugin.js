import createFastifyPlugin from 'fastify-plugin'

/** @import { FastifyInstance, FastifyPluginAsync } from 'fastify' */

/** @type {FastifyPluginAsync<never>} */
const baseUrlPlugin = async (fastify) => {
  fastify.decorateRequest('baseUrl', null)
  fastify.addHook(
    'onRequest',
    /**
     * @this {FastifyInstance} req
     */
    async function (req) {
      req.baseUrl = new URL(this.prefix, `${req.protocol}://${req.hostname}`)
    },
  )
}

export default createFastifyPlugin(baseUrlPlugin, { name: 'baseUrl' })
