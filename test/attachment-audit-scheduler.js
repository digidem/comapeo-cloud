import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { AttachmentAuditScheduler } from '../src/attachment-audit-scheduler.js'

/** @import { TestContext } from 'node:test' */
/** @typedef {import('../src/attachment-audit-scheduler.js').SyncState} SyncState */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DEBOUNCE = 5_000

/**
 * @param {Record<string, { wanted: number, dataSync?: boolean }>} devices data blocks wanted from each device
 * @returns {SyncState}
 */
function syncState(devices) {
  /** @type {SyncState['remoteDeviceSyncState']} */
  const remoteDeviceSyncState = {}
  for (const [deviceId, { wanted, dataSync = true }] of Object.entries(
    devices,
  )) {
    remoteDeviceSyncState[deviceId] = {
      initial: { isSyncEnabled: true, want: 0, wanted: 0 },
      data: { isSyncEnabled: dataSync, want: 0, wanted },
    }
  }
  return {
    initial: { isSyncEnabled: true },
    data: { isSyncEnabled: true },
    remoteDeviceSyncState,
  }
}

class FakeSync extends EventEmitter {
  /** @param {SyncState} state */
  constructor(state) {
    super()
    this.state = state
  }
  getState() {
    return this.state
  }
  /** @param {SyncState} state */
  update(state) {
    this.state = state
    this.emit('sync-state', state)
  }
}

/**
 * @param {TestContext} t
 * @param {{ minIntervalMs?: number }} [options]
 */
function setup(t, { minIntervalMs = HOUR } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  /** @type {Array<{ projectId: string, at: number, done: () => void }>} */
  const audits = []
  const scheduler = new AttachmentAuditScheduler({
    minIntervalMs,
    debounceMs: DEBOUNCE,
    audit(projectId) {
      return new Promise((resolve) => {
        audits.push({ projectId, at: Date.now(), done: resolve })
      })
    },
    log: { debug() {}, error() {} },
  })
  t.after(() => scheduler.close())
  const sync = new FakeSync(syncState({ phone: { wanted: 3 } }))
  scheduler.watch('project-a', { $sync: sync })
  return { scheduler, sync, audits }
}

/** Let the audit's promise chain settle */
const settle = () =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

test('a device leaving runs the audit after the debounce', (t) => {
  const { sync, audits } = setup(t)

  sync.update(syncState({}))
  t.mock.timers.tick(DEBOUNCE - 1)
  assert.equal(audits.length, 0, 'not before the debounce')
  t.mock.timers.tick(1)
  assert.deepEqual(
    audits.map(({ projectId, at }) => ({ projectId, at })),
    [{ projectId: 'project-a', at: DEBOUNCE }],
  )
})

test('wanting nothing more from the data namespaces runs the audit', (t) => {
  const { sync, audits } = setup(t)

  sync.update(syncState({ phone: { wanted: 1 } }))
  sync.update(syncState({ phone: { wanted: 0 } }))
  t.mock.timers.tick(DEBOUNCE)
  assert.equal(audits.length, 1)
})

test('a device joining or sending more does not run the audit', (t) => {
  const { sync, audits } = setup(t)

  sync.update(syncState({ phone: { wanted: 3 }, tablet: { wanted: 2 } }))
  sync.update(syncState({ phone: { wanted: 8 }, tablet: { wanted: 2 } }))
  sync.update(syncState({ phone: { wanted: 0 }, tablet: { wanted: 2 } }))
  t.mock.timers.tick(HOUR)
  assert.equal(audits.length, 0)
})

test('a device that only did presync leaving does not run the audit', (t) => {
  const { sync, audits } = setup(t)

  sync.update(
    syncState({ phone: { wanted: 3 }, tablet: { wanted: 0, dataSync: false } }),
  )
  sync.update(syncState({ phone: { wanted: 3 } }))
  t.mock.timers.tick(HOUR)
  assert.equal(audits.length, 0)

  sync.update(syncState({ phone: { wanted: 3, dataSync: false } }))
  sync.update(syncState({}))
  t.mock.timers.tick(DEBOUNCE)
  assert.equal(audits.length, 1, 'but one that synced data before does')
})

test('sync ends close together share one audit', (t) => {
  const { sync, audits } = setup(t)

  sync.update(syncState({ phone: { wanted: 3 }, tablet: { wanted: 2 } }))
  sync.update(syncState({ tablet: { wanted: 2 } }))
  t.mock.timers.tick(DEBOUNCE - 1000)
  sync.update(syncState({}))
  t.mock.timers.tick(1000)
  assert.equal(audits.length, 0, 'the second departure restarts the debounce')
  t.mock.timers.tick(DEBOUNCE - 1000)
  assert.equal(audits.length, 1)
  assert.equal(audits[0]?.at, 2 * DEBOUNCE - 1000)
})

test('a second audit within the minimum interval waits for it', async (t) => {
  const { sync, audits } = setup(t)

  sync.update(syncState({}))
  t.mock.timers.tick(DEBOUNCE)
  assert.equal(audits.length, 1)
  audits[0]?.done()
  await settle()

  t.mock.timers.tick(10 * MINUTE)
  sync.update(syncState({ phone: { wanted: 3 } }))
  sync.update(syncState({}))
  t.mock.timers.tick(HOUR - 10 * MINUTE - 1)
  assert.equal(audits.length, 1, 'not before an hour has passed')
  t.mock.timers.tick(1)
  assert.equal(audits.length, 2, 'not dropped either')
  assert.equal(audits[1]?.at, DEBOUNCE + HOUR)
})

test('a sync ending while the audit runs queues one more run', async (t) => {
  const { sync, audits } = setup(t)

  sync.update(syncState({}))
  t.mock.timers.tick(DEBOUNCE)
  assert.equal(audits.length, 1)

  sync.update(syncState({ phone: { wanted: 3 } }))
  sync.update(syncState({}))
  sync.update(syncState({ tablet: { wanted: 1 } }))
  sync.update(syncState({}))
  t.mock.timers.tick(HOUR)
  assert.equal(audits.length, 1, 'nothing starts while one is running')

  audits[0]?.done()
  await settle()
  t.mock.timers.tick(DEBOUNCE)
  assert.equal(audits.length, 2)
  assert.equal(audits[1]?.at, DEBOUNCE + HOUR + DEBOUNCE)
})

test('close cancels a pending audit and stops listening', (t) => {
  const { scheduler, sync, audits } = setup(t)

  sync.update(syncState({}))
  scheduler.close()
  t.mock.timers.tick(DEBOUNCE)
  sync.update(syncState({ phone: { wanted: 1 } }))
  sync.update(syncState({}))
  t.mock.timers.tick(HOUR)
  assert.equal(audits.length, 0)
  assert.equal(sync.listenerCount('sync-state'), 0)
})

test('watching a project twice attaches one listener', (t) => {
  const { scheduler, sync, audits } = setup(t)

  scheduler.watch('project-a', { $sync: sync })
  assert.equal(sync.listenerCount('sync-state'), 1)
  sync.update(syncState({}))
  t.mock.timers.tick(DEBOUNCE)
  assert.equal(audits.length, 1)
})
