import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from '@scalar/rust-fmt'

const root = fileURLToPath(new URL('../../src-tauri/', import.meta.url))

async function rustFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await rustFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.rs')) files.push(path)
  }
  return files
}

const files = (await rustFiles(root)).sort()
const failures = []
const canonical = value => value.replace(/\r\n/g, '\n')

for (const file of files) {
  const source = await readFile(file, 'utf8')
  try {
    const formatted = await format(source, { edition: '2021' })
    if (canonical(formatted) !== canonical(source)) failures.push(file)
  } catch (error) {
    console.error(`Rust parse/format failure: ${file}`)
    console.error(error)
    process.exitCode = 1
  }
}

if (failures.length) {
  console.error('Rust files require formatting:')
  for (const file of failures) console.error(`  ${file}`)
  process.exitCode = 1
} else if (!process.exitCode) {
  console.log(`Rust formatting and parseability OK (${files.length} files).`)
}
