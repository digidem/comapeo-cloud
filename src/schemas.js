import { Type } from '@sinclair/typebox'

const HEX_REGEX_32_BYTES = '^[0-9a-fA-F]{64}$'
export const HEX_STRING_32_BYTES = Type.String({ pattern: HEX_REGEX_32_BYTES })

const refType = Type.Object({
  docId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
})
const dateTimeString = Type.String({ format: 'date-time' })
const latitude = Type.Number({ minimum: -90, maximum: 90 })
const longitude = Type.Number({ minimum: -180, maximum: 180 })
const tagsType = Type.Record(
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
)

const commonDataTypeProps = {
  docId: Type.String(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
  deleted: Type.Boolean(),
}

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
  ...commonDataTypeProps,
  lat: Type.Optional(latitude),
  lon: Type.Optional(longitude),
  attachments: Type.Array(
    Type.Object({
      url: Type.String(),
    }),
  ),
  tags: tagsType,
})

export const trackResult = Type.Object({
  ...commonDataTypeProps,
  locations: Type.Array(
    Type.Object({
      timestamp: dateTimeString,
      mocked: Type.Boolean(),
      coords: Type.Object({
        latitude,
        longitude,
        altitude: Type.Optional(Type.Number()),
        heading: Type.Optional(Type.Number()),
        speed: Type.Optional(Type.Number()),
        accuracy: Type.Optional(Type.Number()),
      }),
    }),
  ),
  observationRefs: Type.Array(refType),
  tags: tagsType,
  presetRef: refType,
})

const languageCodeValidation = Type.Regex(/^[a-z]{3}$/u)
const regionCodeValidation = Type.Regex(/^[A-Z]{2}|[0-9]{3}$/u)

export const translationResult = Type.Object({
  ...commonDataTypeProps,
  docRef: refType,
  docRefType: Type.Enum([
    'type_unspecified',
    'deviceInfo',
    'preset',
    'field',
    'observation',
    'projectSettings',
    'role',
    'track',
    'UNRECOGNIZED',
  ]),
  propertyRef: Type.String({ minLength: 1 }),
  languageCode: languageCodeValidation,
  regionCode: regionCodeValidation,
  message: Type.String(),
})

const sizeEnum = Type.Enum(['size_unspecified', 'small', 'medium', 'large'])
const blobVersionId = Type.String({ minLength: 1 })

export const iconResult = Type.Object({
  ...commonDataTypeProps,
  name: Type.String({ minLength: 1 }),
  variants: Type.Array(
    Type.Object({
      oneOf: [
        Type.Object({
          mimeType: Type.Literal('image/png'),
          size: sizeEnum,
          pixelDensity: Type.Enum([1, 2, 3]),
          blobVersionId,
        }),
        Type.Object({
          size: sizeEnum,
          mimeType: Type.Literal('image/svg+xml'),
          blobVersionId,
        }),
      ],
    }),
  ),
})

export const fieldSchema = Type.Object({
  ...commonDataTypeProps,
  tagKey: Type.String({ minLength: 1 }),
  type: Type.Enum([
    'type_unspecified',
    'text',
    'number',
    'selectOne',
    'selectMultiple',
  ]),
  label: Type.String({ minLength: 1 }),
  appearance: Type.Enum(['appearance_unspecified', 'singleline', 'multiline'], {
    default: 'multiline',
  }),
  snakeCase: Type.Boolean({ default: false }),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        label: Type.String({ minLength: 1 }),
        value: Type.Union([
          Type.String(),
          Type.Boolean(),
          Type.Number(),
          Type.Null(),
        ]),
      }),
    ),
  ),
  universal: Type.Boolean({ default: false }),
  placeholder: Type.Optional(Type.String()),
  helperText: Type.Optional(Type.String()),
})

export const presetResult = Type.Object({
  ...commonDataTypeProps,
  name: Type.String(),
  geometry: Type.Array(
    Type.Enum(['point', 'vertex', 'line', 'area', 'relation']),
  ),
  tags: tagsType,
  addTags: tagsType,
  removeTags: tagsType,
  fieldRefs: Type.Array(refType),
  iconRef: refType,
  terms: Type.Array(Type.String()),
  color: Type.RegEx(/^#[a-fA-F0-9]{6}$/u),
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
  ...commonDataTypeProps,
  ...remoteDetectionAlertCommon,
})
