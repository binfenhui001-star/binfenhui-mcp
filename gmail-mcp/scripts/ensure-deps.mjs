#!/usr/bin/env node
/**
 * Ensure @shinzolabs/gmail-mcp is installed under mcp/gmail-mcp/node_modules.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(
  root,
  'node_modules',
  '@shinzolabs',
  'gmail-mcp',
  'dist',
  'index.js',
)

if (existsSync(entry)) {
  console.log('[gmail-mcp] dependencies OK')
  process.exit(0)
}

console.log('[gmail-mcp] installing production dependencies...')
const r = spawnSync('npm', ['install', '--omit=dev'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(r.status ?? 1)
