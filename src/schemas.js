import { Type } from '@sinclair/typebox'

const HEX_REGEX_32_BYTES = '^[0-9a-fA-F]{64}$'
export const HEX_STRING_32_BYTES = Type.String({ pattern: HEX_REGEX_32_BYTES })

const dateTimeString = Type.String({ format: 'date-time' })
const latitude = Type.Number({ minimum: -90, maximum: 90 })
const longitude = Type.Number({ minimum: -180, maximum: 180 })

export const errorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
  }),
})

export const projectToAdd = Type.Object({
  projectName: Type.String({ minLength: 1 }),
  projectKey: HEX_STRING_32_BYTES,
  encryptionKeys: Type.Object({
    auth: HEX_STRING_32_BYTES,
    config: HEX_STRING_32_BYTES,
    data: HEX_STRING_32_BYTES,
    blobIndex: HEX_STRING_32_BYTES,
    blob: HEX_STRING_32_BYTES,
  }),
})

export const observationResult = Type.Object({
  docId: Type.String(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
  deleted: Type.Boolean(),
  lat: Type.Optional(latitude),
  lon: Type.Optional(longitude),
  attachments: Type.Array(
    Type.Object({
      url: Type.String(),
    }),
  ),
  tags: Type.Record(
    Type.String(),
    Type.Union([
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Null(),
      Type.Array(
        Type.Union([Type.Boolean(), Type.Number(), Type.String(), Type.Null()]),
      ),
    ]),
  ),
})

const position = Type.Tuple([longitude, latitude])

const remoteDetectionAlertCommon = {
  detectionDateStart: dateTimeString,
  detectionDateEnd: dateTimeString,
  sourceId: Type.String({ minLength: 1 }),
  metadata: Type.Record(
    Type.String(),
    Type.Union([
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Null(),
      Type.Array(
        Type.Union([Type.Boolean(), Type.Number(), Type.String(), Type.Null()]),
      ),
    ]),
  ),
  geometry: Type.Union([
    Type.Object({
      type: Type.Literal('Point'),
      coordinates: position,
    }),
    Type.Object({
      type: Type.Literal('LineString'),
      coordinates: Type.Array(position, { minItems: 2 }),
    }),
    Type.Object({
      type: Type.Literal('MultiLineString'),
      coordinates: Type.Array(Type.Array(position, { minItems: 2 })),
    }),
    Type.Object({
      type: Type.Literal('Polygon'),
      coordinates: Type.Array(Type.Array(position, { minItems: 4 })),
    }),
    Type.Object({
      type: Type.Literal('MultiPoint'),
      coordinates: Type.Array(position),
    }),
    Type.Object({
      type: Type.Literal('MultiPolygon'),
      coordinates: Type.Array(
        Type.Array(Type.Array(position, { minItems: 4 })),
      ),
    }),
  ]),
}

export const remoteDetectionAlertToAdd = Type.Object({
  ...remoteDetectionAlertCommon,
})

export const remoteDetectionAlertResult = Type.Object({
  docId: Type.String(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
  deleted: Type.Boolean(),
  ...remoteDetectionAlertCommon,
})
