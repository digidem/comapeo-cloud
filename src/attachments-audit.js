/** @import { MapeoProject } from '@comapeo/core' */
/** @import { Static } from '@sinclair/typebox' */
/** @import { attachmentAudit } from './schemas.js' */

/** @typedef {Static<typeof attachmentAudit>} AttachmentAudit */
/** @typedef {AttachmentAudit['failures'][number]} AttachmentFailure */
/** @typedef {AttachmentFailure['status'] | 'ok'} AttachmentStatus */
/**
 * @typedef {object} AttachmentCheck
 * @prop {AttachmentStatus} status
 * @prop {string} detail one line for humans: upstream status and code, or why the read failed
 * @prop {string} [upstreamCode] error code sent by core's blob server, when it sent one
 */

const VARIANTS = /** @type {const} */ ({
  photo: ['original', 'preview', 'thumbnail'],
  audio: ['original'],
})

/** @typedef {Awaited<ReturnType<MapeoProject['observation']['getMany']>>[number]['attachments'][number]} Attachment */

/**
 * @param {Attachment} attachment
 * @returns {attachment is Attachment & { type: keyof typeof VARIANTS }}
 */
const isSupportedAttachment = (attachment) =>
  Object.hasOwn(VARIANTS, attachment.type)

/**
 * Classify a non-200 response from core's blob server
 * @param {Response} response
 * @param {string} body
 * @returns {AttachmentCheck}
 */
export function upstreamFailure(response, body) {
  /** @type {string | undefined} */
  let upstreamCode
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.code === 'string') upstreamCode = parsed.code
  } catch {
    // not JSON
  }
  return {
    status: response.status === 404 ? 'missing' : 'error',
    detail: `${response.status} ${upstreamCode || response.statusText}`.trim(),
    upstreamCode,
  }
}

/**
 * @param {unknown} err
 * @returns {AttachmentCheck}
 */
export function fetchFailure(err) {
  if (!(err instanceof Error)) {
    return { status: 'incomplete', detail: String(err) }
  }
  // undici's message is always 'fetch failed'; the reason is in the cause
  const cause = /** @type {{ code?: string, message?: string } | undefined} */ (
    err.cause
  )
  const reason = cause?.code ?? cause?.message
  return {
    status: 'incomplete',
    detail: reason ? `${err.message}: ${reason}` : err.message,
  }
}

/**
 * Fetch a blob from core's blob server and read it to the end
 * @param {string} blobUrl
 * @returns {Promise<AttachmentCheck>}
 */
export async function checkBlob(blobUrl) {
  let response
  try {
    response = await fetch(blobUrl, { signal: AbortSignal.timeout(60_000) })
  } catch (err) {
    return fetchFailure(err)
  }
  if (response.status !== 200) {
    return upstreamFailure(response, await response.text())
  }
  let bytes = 0
  try {
    if (response.body) {
      for await (const chunk of response.body) bytes += chunk.length
    }
  } catch (err) {
    return {
      status: 'incomplete',
      detail: `${fetchFailure(err).detail} after ${bytes} bytes`,
    }
  }
  return { status: 'ok', detail: `${bytes} bytes` }
}

/**
 * Check every variant of every photo and audio attachment in a project. Each
 * failure carries the device that created the observation, since that is the
 * device that has to sync again, and `devices` names those devices.
 * @param {MapeoProject} project
 * @param {object} [options]
 * @param {number} [options.maxAttachments] newest observations first
 * @returns {Promise<AttachmentAudit>}
 */
export async function auditAttachments(
  project,
  { maxAttachments = Infinity } = {},
) {
  const observations = await project.observation.getMany()
  observations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  /** @type {AttachmentAudit} */
  const result = {
    observations: observations.length,
    attachments: 0,
    audited: 0,
    ok: 0,
    missing: 0,
    incomplete: 0,
    error: 0,
    failures: [],
    devices: {},
  }

  const attachments = observations.flatMap((obs) =>
    obs.attachments
      .filter(isSupportedAttachment)
      .map((attachment) => ({ attachment, createdBy: obs.createdBy })),
  )
  result.attachments = attachments.length

  for (const { attachment, createdBy } of attachments.slice(
    0,
    maxAttachments,
  )) {
    const { driveDiscoveryId, type, name } = attachment
    result.audited++
    for (const variant of VARIANTS[type]) {
      const blobUrl = await project.$blobs.getUrl(
        /** @type {Parameters<typeof project.$blobs.getUrl>[0]} */ ({
          driveId: driveDiscoveryId,
          type,
          variant,
          name,
        }),
      )
      const check = await checkBlob(blobUrl)
      result[check.status]++
      if (check.status !== 'ok') {
        result.failures.push({
          driveDiscoveryId,
          createdBy,
          type,
          name,
          variant,
          status: check.status,
          detail: check.detail,
        })
      }
    }
  }

  if (result.failures.length > 0) {
    const members = await project.$member.getMany({ includeLeft: true })
    const createdBy = new Set(result.failures.map((f) => f.createdBy))
    for (const { deviceId, name } of members) {
      if (name && createdBy.has(deviceId)) result.devices[deviceId] = name
    }
  }

  return result
}
