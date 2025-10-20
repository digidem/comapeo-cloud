import { dereferencedDocSchemas } from '@comapeo/schema'
import { schema2typebox } from 'schema2typebox'
import * as ts from 'typescript'

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TO_GEN = ['observation', 'track', 'preset', 'field', 'icon']

const observationSchema = {
  ...dereferencedDocSchemas.observation,
  properties: {
    ...dereferencedDocSchemas.observation.properties,
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
    tags: {
      ...dereferencedDocSchemas.observation.properties.tags,
      // eslint-disable-next-line no-undefined
      properties: undefined,
    },
  },
}

const presetSchema = {
  ...dereferencedDocSchemas.preset,
  properties: {
    ...dereferencedDocSchemas.preset.properties,
    tags: {
      ...dereferencedDocSchemas.preset.properties.tags,
      // eslint-disable-next-line no-undefined
      properties: undefined,
    },
    addTags: {
      ...dereferencedDocSchemas.preset.properties.addTags,
      // eslint-disable-next-line no-undefined
      properties: undefined,
    },
    removeTags: {
      ...dereferencedDocSchemas.preset.properties.removeTags,
      // eslint-disable-next-line no-undefined
      properties: undefined,
    },
  },
}

const trackSchema = {
  ...dereferencedDocSchemas.track,
  properties: {
    ...dereferencedDocSchemas.track.properties,
    tags: {
      ...dereferencedDocSchemas.track.properties.tags,
      // eslint-disable-next-line no-undefined
      properties: undefined,
    },
  },
}

const schemas = {
  ...dereferencedDocSchemas,
  observation: observationSchema,
  preset: presetSchema,
  track: trackSchema,
}

const dataTypesDir = join(import.meta.dirname, './src/datatypes')

await mkdir(dataTypesDir, {
  recursive: true,
})

const matchVar = / var /gu

await Promise.all(
  TO_GEN.map(async (name) => {
    const schema = schemas[name]

    console.log(name, 'parsing')
    const file = JSON.stringify(schema)

    console.log(name, 'generating ts')
    const source = await schema2typebox({ input: file })

    console.log(name, 'compiling')
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
