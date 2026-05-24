import { getTikhubApiKey } from './config.js'

const BASE = 'https://api.tikhub.io'

export async function tikhubFetch(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getTikhubApiKey()}` },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`TikHub HTTP ${res.status} ${path}: ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`TikHub invalid JSON ${path}: ${text.slice(0, 200)}`)
  }
}

export async function tikhubPing(): Promise<{ ok: true; message: string }> {
  getTikhubApiKey()
  // Lightweight call — search with minimal count
  await tikhubFetch('/api/v1/tiktok/web/fetch_search_user', {
    keyword: 'test',
    cursor: 0,
  })
  return { ok: true, message: 'TikHub API key is valid' }
}
