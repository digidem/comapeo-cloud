// This file should be read by TypeScript and augments the FastifyInstance.
//
// Unfortunately it does this globally, which is a limitation of Fastify
// TypeScript support currently, so need to be careful about using this where it
// is not in scope.
import { type MapeoManager } from '@comapeo/core'

declare module 'fastify' {
  interface FastifyInstance {
    comapeo: MapeoManager
  }
  interface FastifyRequest {
    baseUrl: URL
  }
}
