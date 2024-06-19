import { MapeoManager } from '@mapeo/core'
import Fastify from 'fastify'
import RAM from 'random-access-memory'

import * as path from 'node:path'

const migrationsFolderPath = new URL(
  '../node_modules/@mapeo/core/drizzle',
  import.meta.url,
).pathname

export class Server {
  #fastify = Fastify()
  #mapeoManager

  constructor() {
    this.#mapeoManager = new MapeoManager({
      // TODO: Don't hard-code this
      rootKey: Buffer.from('mWZ5Qi0oay0KInZ9F/pMCQ==', 'base64'),
      // TODO: Save database to disk
      dbFolder: ':memory:',
      clientMigrationsFolder: path.join(migrationsFolderPath, 'client'),
      projectMigrationsFolder: path.join(migrationsFolderPath, 'project'),
      // TODO: Save data to disk
      coreStorage: () => new RAM(),
      fastify: this.#fastify,
    })
  }

  /**
   * @param {object} options
   * @param {number} options.port
   * @returns {Promise<void>}
   */
  listen({ port }) {
    // TODO
    console.log('Starting server on port ' + port)
    console.log(this.#mapeoManager)
    return Promise.resolve()
  }

  /**
   * @returns {Promise<void>}
   */
  close() {
    // TODO
    return Promise.resolve()
  }
}
