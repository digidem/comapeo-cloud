#!/usr/bin/env node
// @ts-check
import process from 'node:process'

import { Server } from '../server.js'

const port = 3000

const server = new Server()

await server.listen({ port })

/** @param {NodeJS.Signals} signal*/
async function closeGracefully(signal) {
  await server.close()
  process.kill(process.pid, signal)
}
process.once('SIGINT', closeGracefully)
process.once('SIGTERM', closeGracefully)
