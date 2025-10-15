import { docSchemas } from '@comapeo/schema'
import { schema2typebox } from 'schema2typebox'
import * as ts from 'typescript'

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TO_GEN = ['observation', 'track', 'preset', 'field', 'icon']

const observationSchema = {
  ...docSchemas.observation,
  definitions: {
    ...docSchemas.observation.definitions,
    attachment: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Path to fetching attachment data',
        },
      },
    },
  },
}

const schemas = {
  ...docSchemas,
  observation: observationSchema,
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
