import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  getOutputDir,
  getProfileDelayMs,
  getSearchDelayMs,
} from './config.js'
import { extractEmail } from './extract-email.js'
import {
  mergeCreator,
  parseAuthorsFromVideoSearch,
  parseUsersFromSearchUserResponse,
} from './parse-response.js'
import { scoreCreator, tierFromScore } from './scoring.js'
import { tikhubFetch } from './tikhub-client.js'
import type {
  BatchSourcingInput,
  BatchSourcingResult,
  KolCreator,
  SearchTask,
} from './types.js'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'kol'
}

function escCsv(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

async function searchUsersByKeyword(
  task: SearchTask,
  maxPages: number,
  followerMin: number,
  map: Map<string, KolCreator>,
): Promise<number> {
  let cursor = 0
  let added = 0
  for (let page = 0; page < maxPages; page++) {
    const data = await tikhubFetch('/api/v1/tiktok/web/fetch_search_user', {
      keyword: task.keyword,
      cursor,
    })
    const batch = parseUsersFromSearchUserResponse(data, task.keyword, task.dimension)
    const before = map.size
    for (const c of batch) mergeCreator(map, c, followerMin)
    added += map.size - before
    const inner = (data as Record<string, unknown>).data as Record<string, unknown>
    const hasMore = Boolean(inner?.has_more)
    const next = Number(inner?.cursor ?? 0)
    if (!hasMore || !batch.length) break
    cursor = next
    await sleep(getSearchDelayMs())
  }
  return added
}

async function searchVideosByKeyword(
  task: SearchTask,
  maxPages: number,
  followerMin: number,
  map: Map<string, KolCreator>,
): Promise<number> {
  let offset = 0
  let added = 0
  for (let page = 0; page < maxPages; page++) {
    const data = await tikhubFetch(
      '/api/v1/tiktok/app/v3/fetch_general_search_result',
      {
        keyword: task.keyword,
        offset,
        count: 20,
        search_type: 1,
      },
    )
    const batch = parseAuthorsFromVideoSearch(data, task.keyword, task.dimension)
    const before = map.size
    for (const c of batch) mergeCreator(map, c, followerMin)
    added += map.size - before
    const inner = (data as Record<string, unknown>).data as Record<string, unknown>
    const items = (inner?.data as unknown[]) ?? []
    if (!items.length) break
    const hasMore = Boolean(inner?.has_more)
    if (!hasMore) break
    offset += items.length
    await sleep(getSearchDelayMs())
  }
  return added
}

async function enrichProfiles(map: Map<string, KolCreator>): Promise<void> {
  const creators = Array.from(map.values())
  for (const c of creators) {
    try {
      const data = await tikhubFetch('/api/v1/tiktok/app/v3/handler_user_profile', {
        unique_id: c.unique_id,
      })
      const user = (data as Record<string, unknown>)?.data as Record<string, unknown>
      const u = user?.user as Record<string, unknown> | undefined
      if (!u) continue
      const fullBio = String(u.signature ?? '')
      c.bio = fullBio || c.bio
      c.nickname = String(u.nickname ?? c.nickname)
      c.follower_count = Number(u.follower_count ?? c.follower_count)
      c.video_count = Number(u.aweme_count ?? c.video_count)
      const link = u.bioLink as Record<string, unknown> | undefined
      c.bio_link = link?.link ? String(link.link) : c.bio_link
      const email = extractEmail(fullBio)
      if (email) c.email = email
      await sleep(getProfileDelayMs())
    } catch {
      /* single profile failure — continue */
    }
  }
}

export async function runBatchSourcing(
  input: BatchSourcingInput,
): Promise<BatchSourcingResult> {
  const followerMin = input.follower_min ?? 5_000
  const followerMax = input.follower_max ?? 5_000_000
  const targetTotal = input.target_total ?? 50
  const maxPages = input.max_pages_per_keyword ?? 4
  const enrich = input.enrich_profiles !== false
  const mode = input.search_mode ?? 'videos'
  const categoryKeywords = (input.category_keywords ?? []).map((k) => k.toLowerCase())

  const map = new Map<string, KolCreator>()
  const keywordStats: Record<string, number> = {}

  for (const task of input.search_tasks) {
    if (mode === 'users') {
      await searchUsersByKeyword(task, maxPages, followerMin, map)
    } else {
      await searchVideosByKeyword(task, maxPages, followerMin, map)
    }
    const count = Array.from(map.values()).filter(
      (c) => c.search_keyword === task.keyword,
    ).length
    keywordStats[task.keyword] = count
  }

  const totalRaw = map.size
  if (enrich && map.size > 0) {
    await enrichProfiles(map)
  }

  const scoringOpts = {
    categoryKeywords,
    followerMin,
    followerMax,
  }

  const scored = Array.from(map.values())
    .map((c) => {
      const priority_score = scoreCreator(c, scoringOpts)
      const tier = tierFromScore(priority_score)
      const bio = (c.bio || '').toLowerCase()
      return {
        ...c,
        priority_score,
        tier,
        has_email: Boolean(c.email),
        bio_category_match: categoryKeywords.some((k) => bio.includes(k)),
      }
    })
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .slice(0, targetTotal)

  const outDir = getOutputDir()
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const slug = slugify(input.product_label)
  const csvPath = join(outDir, `kol-${slug}-${ts}.csv`)

  const header =
    'priority_score,tier,username,nickname,follower_count,video_count,bio,email,bio_link,profile_url,best_video_plays,best_video_likes,best_video_desc,search_keyword,dimension,has_email,bio_category_match'
  const rows = scored.map((c) =>
    [
      c.priority_score,
      c.tier,
      escCsv(`@${c.unique_id}`),
      escCsv(c.nickname),
      c.follower_count,
      c.video_count,
      escCsv(c.bio),
      escCsv(c.email ?? ''),
      escCsv(c.bio_link ?? ''),
      escCsv(c.profile_url),
      c.best_video_plays,
      c.best_video_likes,
      escCsv(c.best_video_desc),
      escCsv(c.search_keyword),
      c.dimension,
      c.has_email ? 1 : 0,
      c.bio_category_match ? 1 : 0,
    ].join(','),
  )
  writeFileSync(csvPath, `\uFEFF${header}\n${rows.join('\n')}\n`, 'utf8')

  const meta = {
    product: input.product_label,
    timestamp: ts,
    total: scored.length,
    total_raw: totalRaw,
    tier_a: scored.filter((c) => c.tier === 'A').length,
    tier_b: scored.filter((c) => c.tier === 'B').length,
    tier_c: scored.filter((c) => c.tier === 'C').length,
    emailCount: scored.filter((c) => c.email).length,
    csv_path: csvPath,
    keyword_stats: keywordStats,
    upstream: 'https://github.com/waynefu2020/tikhub-kol-sourcing',
  }
  writeFileSync(csvPath.replace(/\.csv$/, '.meta.json'), JSON.stringify(meta, null, 2), 'utf8')

  return {
    product_label: input.product_label,
    total_raw: totalRaw,
    total_exported: scored.length,
    tier_a: meta.tier_a,
    tier_b: meta.tier_b,
    tier_c: meta.tier_c,
    with_email: meta.emailCount,
    csv_path: csvPath,
    keyword_stats: keywordStats,
    top_creators: scored.slice(0, 10).map((c) => ({
      tier: c.tier ?? 'C',
      score: c.priority_score ?? 0,
      username: `@${c.unique_id}`,
      followers: c.follower_count,
      email: c.email,
      keyword: c.search_keyword,
    })),
  }
}
