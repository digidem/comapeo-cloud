import { dereferencedDocSchemas as schemas } from '@comapeo/schema'

const HEX_REGEX_32_BYTES = '^[0-9a-fA-F]{64}$'
export const HEX_STRING_32_BYTES = {
  type: 'string',
  pattern: HEX_REGEX_32_BYTES,
}

const COMMON_EXCLUDES = [
  'docId',
  'versionId',
  'originalVersionId',
  'createdAt',
  'updatedAt',
  'schema',
  'links',
  'deleted',
]

function excludeCommonDBProps(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => !COMMON_EXCLUDES.includes(key),
    ),
  )
}

export const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
}

export const projectToAdd = {
  type: 'object',
  properties: {
    projectName: {
      type: 'string',
      minLength: 1,
    },
    projectKey: {
      type: 'string',
      pattern: '^([0-9a-fA-F]{2}){32}$',
    },
    encryptionKeys: {
      type: 'object',
      properties: {
        auth: {
          type: 'string',
          pattern: '^([0-9a-fA-F]{2}){32}$',
        },
        config: {
          type: 'string',
          pattern: '^([0-9a-fA-F]{2}){32}$',
        },
        data: {
          type: 'string',
          pattern: '^([0-9a-fA-F]{2}){32}$',
        },
        blobIndex: {
          type: 'string',
          pattern: '^([0-9a-fA-F]{2}){32}$',
        },
        blob: {
          type: 'string',
          pattern: '^([0-9a-fA-F]{2}){32}$',
        },
      },
      required: ['auth', 'config', 'data', 'blobIndex', 'blob'],
    },
  },
  required: ['projectName', 'projectKey', 'encryptionKeys'],
}

export const observationResult = schemas.observation

export const trackResult = schemas.track

export const translationResult = schemas.translation

export const iconResult = schemas.icon

export const fieldSchema = schemas.field

export const presetResult = schemas.preset

export const remoteDetectionAlertToAdd = { ...schemas.remoteDetectionAlert }
remoteDetectionAlertToAdd.properties = excludeCommonDBProps(
  remoteDetectionAlertToAdd.properties,
)
remoteDetectionAlertToAdd.required = remoteDetectionAlertToAdd.required.filter(
  (name) => !COMMON_EXCLUDES.includes(name),
)

console.log(remoteDetectionAlertToAdd)

export const remoteDetectionAlertResult = schemas.remoteDetectionAlert
