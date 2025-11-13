import { dereferencedDocSchemas as originals } from '@comapeo/schema'
import { schema2typebox } from 'schema2typebox'
import * as ts from 'typescript'

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TO_GEN = ['observation', 'track', 'preset', 'field']

// We extend the schema instead of assigning values to a clone
// because JSDoc has no clean way to mark nested trees as mutable

// These are not part of the scheme but are added by the DataType class
// to show who authored a particular change
const authorFields = {
  createdBy: {
    type: 'string',
  },
  updatedBy: {
    type: 'string',
  },
}

const observationSchema = extendProperties(originals.observation, {
  ...authorFields,
  attachments: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Path to fetching attachment data',
        },
      },
    },
  },
  // We add URLs to various `ref` fields inline with how attachments get URLs
  presetRef: addUrlField(originals.observation.properties.presetRef),
})

const presetSchema = extendProperties(originals.preset, {
  ...authorFields,
  fieldRefs: addUrlFieldArray(originals.preset.properties.fieldRefs),
  iconRef: addUrlField(originals.preset.properties.iconRef),
})

const trackSchema = extendProperties(originals.track, {
  ...authorFields,
  observationRefs: addUrlFieldArray(originals.track.properties.observationRefs),
  presetRef: addUrlField(originals.track.properties.presetRef),
})

const fieldSchema = extendProperties(originals.field, authorFields)

const schemas = {
  field: fieldSchema,
  observation: observationSchema,
  preset: presetSchema,
  track: trackSchema,
}

const dataTypesDir = join(import.meta.dirname, './src/datatypes')

await mkdir(dataTypesDir, {
  recursive: true,
})

// schema2typebox delcars var witu `var` instead of const
// This interferes with our lint rules so we convert it to const
const matchVar = / var /gu

await Promise.all(
  TO_GEN.map(async (name) => {
    const schema = schemas[name]

    console.log(name, 'parsing')
    const file = JSON.stringify(schema)

    console.log(name, 'generating ts')
    const source = await schema2typebox({ input: file })

    console.log(name, 'compiling')
    // They output TS so we want to translate it directly to JS
    const { outputText: compiled } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
      },
    })

    const final = compiled.replace(matchVar, ' const ')

    const outPath = join(dataTypesDir, `${name}.js`)
    console.log(name, 'saving', outPath)
    await writeFile(outPath, final)
    console.log(name, 'done!')
  }),
)

/**
 * Extends the properties of a schema with new properties.
 *
 * @param {Record<string, any>} schema - The original schema.
 * @param {Record<string, any>} properties - New properties to extend the schema with.
 * @returns {Record<string, any>} - The extended schema with additional properties.
 */
function extendProperties(schema, properties) {
  return {
    ...schema,
    properties: {
      ...schema.properties,
      ...properties,
    },
  }
}

/**
 * @typedef {{ properties: Record<string, unknown>, required?: Readonly<string[]> }} SchemaWithProperties
 */

/**
 * Adds a URL field to a JSON schema object
 * @template {object} T
 * @param {T & SchemaWithProperties} schema - The JSON schema object to extend
 * @returns {T & { properties: { url: { type: 'string' } } }} The schema with an added url property
 */
function addUrlField(schema) {
  const required = schema.required ? schema.required.concat('url') : ['url']

  return {
    ...schema,
    properties: {
      ...schema.properties,
      url: { type: 'string' },
    },
    required,
  }
}

/**
 * Adds a URL field to the properties of each item in the array within a JSON schema object.
 * @template {object} T
 * @param {T & { items: SchemaWithProperties }} arraySchema - The JSON schema object with an array as its items to extend
 * @returns {T & { items: { properties: { url: { type: 'string' } } } }} The schema with a URL field added to each item's properties
 */
function addUrlFieldArray(arraySchema) {
  return {
    ...arraySchema,
    items: addUrlField(arraySchema.items),
  }
}
