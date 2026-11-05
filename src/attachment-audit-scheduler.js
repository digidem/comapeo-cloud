/** @import { MapeoProject } from '@comapeo/core' */
/** @import { FastifyBaseLogger } from 'fastify' */

/** @typedef {ReturnType<MapeoProject['$sync']['getState']>} SyncState */
/**
 * The part of a project's `$sync` the scheduler uses
 * @typedef {object} WatchedSync
 * @prop {() => SyncState} getState
 * @prop {(event: 'sync-state', listener: (state: SyncState) => void) => unknown} on
 * @prop {(event: 'sync-state', listener: (state: SyncState) => void) => unknown} off
 */
/** @typedef {{ $sync: WatchedSync }} WatchedProject */

/**
 * @typedef {object} ProjectWatch
 * @prop {string} projectId
 * @prop {WatchedProject} project
 * @prop {SyncState} previous
 * @prop {Set<string>} dataPeers connected devices that have had data sync enabled
 * @prop {(state: SyncState) => void} onSyncState
 * @prop {NodeJS.Timeout} [timer]
 * @prop {number} lastStartedAt
 * @prop {boolean} running
 * @prop {boolean} dirty a sync ended while the audit was running
 */

/**
 * Runs an audit for a project after each sync with it ends, at most once per
 * `minIntervalMs`. Audits that would come too soon are delayed to the earliest
 * allowed time rather than dropped. Nothing runs at start.
 */
export class AttachmentAuditScheduler {
  #audit
  #minIntervalMs
  #debounceMs
  #log
  /** @type {Map<string, ProjectWatch>} */
  #watches = new Map()
  #closed = false

  /**
   * @param {object} options
   * @param {(projectId: string) => Promise<void>} options.audit must handle its own errors
   * @param {number} options.minIntervalMs
   * @param {number} [options.debounceMs] wait after a sync ends, so one device leaving does not audit while another is still mid-sync
   * @param {Pick<FastifyBaseLogger, 'debug' | 'error'>} options.log
   */
  constructor({ audit, minIntervalMs, debounceMs = 5_000, log }) {
    this.#audit = audit
    this.#minIntervalMs = minIntervalMs
    this.#debounceMs = debounceMs
    this.#log = log
  }

  /**
   * @param {string} projectId
   * @param {WatchedProject} project
   */
  watch(projectId, project) {
    if (this.#closed || this.#watches.has(projectId)) return
    /** @type {ProjectWatch} */
    const watch = {
      projectId,
      project,
      previous: project.$sync.getState(),
      dataPeers: new Set(),
      onSyncState: (state) => {
        const ended = syncEnded(watch, state)
        watch.previous = state
        if (ended) this.#markDirty(watch)
      },
      lastStartedAt: -Infinity,
      running: false,
      dirty: false,
    }
    this.#watches.set(projectId, watch)
    project.$sync.on('sync-state', watch.onSyncState)
  }

  close() {
    this.#closed = true
    for (const watch of this.#watches.values()) {
      watch.project.$sync.off('sync-state', watch.onSyncState)
      clearTimeout(watch.timer)
    }
    this.#watches.clear()
  }

  /** @param {ProjectWatch} watch */
  #markDirty(watch) {
    if (watch.running) {
      watch.dirty = true
      return
    }
    const now = Date.now()
    const dueAt = Math.max(
      now + this.#debounceMs,
      watch.lastStartedAt + this.#minIntervalMs,
    )
    clearTimeout(watch.timer)
    watch.timer = setTimeout(() => this.#run(watch), dueAt - now)
    watch.timer.unref()
    this.#log.debug(
      { projectId: watch.projectId, inMs: dueAt - now },
      'attachment audit scheduled',
    )
  }

  /** @param {ProjectWatch} watch */
  #run(watch) {
    watch.running = true
    watch.dirty = false
    watch.lastStartedAt = Date.now()
    this.#audit(watch.projectId)
      .catch((err) => {
        this.#log.error({ err, projectId: watch.projectId }, 'attachment audit')
      })
      .then(() => {
        watch.running = false
        if (watch.dirty && !this.#closed) this.#markDirty(watch)
      })
  }
}

/**
 * A sync session has ended when a device that was syncing data drops out of
 * the remote sync state (its connection closed) or when the project stops
 * wanting data blocks. Devices that only did presync, including the brief
 * first connection while a device is being added to the project, are ignored.
 * @param {Pick<ProjectWatch, 'previous' | 'dataPeers'>} watch
 * @param {SyncState} current
 */
function syncEnded({ previous, dataPeers }, current) {
  let ended = false
  for (const deviceId of dataPeers) {
    if (Object.hasOwn(current.remoteDeviceSyncState, deviceId)) continue
    dataPeers.delete(deviceId)
    ended = true
  }
  for (const [deviceId, device] of Object.entries(
    current.remoteDeviceSyncState,
  )) {
    if (device.data.isSyncEnabled) dataPeers.add(deviceId)
  }
  return ended || (dataWanted(previous) > 0 && dataWanted(current) === 0)
}

/** @param {SyncState} state */
function dataWanted(state) {
  let sum = 0
  for (const device of Object.values(state.remoteDeviceSyncState)) {
    sum += device.data.wanted
  }
  return sum
}
