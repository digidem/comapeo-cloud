import { MapeoManager } from '@comapeo/core'
import createFastifyPlugin from 'fastify-plugin'

/** @import { FastifyPluginAsync } from 'fastify' */

/**
 * @typedef {Omit<ConstructorParameters<typeof MapeoManager>[0], 'fastify'>} ComapeoPluginOptions
 */

/** @type {FastifyPluginAsync<ComapeoPluginOptions>} */
const comapeoPlugin = async (fastify, opts) => {
  const comapeo = new MapeoManager({ ...opts, fastify })
  fastify.decorate('comapeo', comapeo)
}

export default createFastifyPlugin(comapeoPlugin, { name: 'comapeo' })
