export class Server {
  /**
   * @param {object} options
   * @param {number} options.port
   * @returns {Promise<void>}
   */
  listen({ port }) {
    // TODO
    console.log('Starting server on port ' + port)
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
