import { homedir } from 'node:os'
import { join } from 'node:path'

export function getTikhubApiKey(): string {
  const key = process.env.TIKHUB_API_KEY?.trim()
  if (!key) {
    throw new Error(
      'TIKHUB_API_KEY is not set. Add it to mcp/.env or tikhub-kol-mcp/.env (register at https://tikhub.io).',
    )
  }
  return key
}

export function getOutputDir(): string {
  const raw = process.env.TIKHUB_KOL_OUTPUT_DIR?.trim()
  if (raw) return raw
  return join(homedir(), '.Claude', 'kol-sourcing', 'output')
}

export function getSearchDelayMs(): number {
  const n = Number(process.env.TIKHUB_KOL_SEARCH_DELAY_MS ?? 1000)
  return Number.isFinite(n) && n >= 0 ? n : 1000
}

export function getProfileDelayMs(): number {
  const n = Number(process.env.TIKHUB_KOL_PROFILE_DELAY_MS ?? 150)
  return Number.isFinite(n) && n >= 0 ? n : 150
}
