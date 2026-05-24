import { extractEmail } from './extract-email.js'
import type { KolCreator, SearchDimension } from './types.js'

function pickUser(raw: Record<string, unknown>): Record<string, unknown> | null {
  const info = raw.user_info as Record<string, unknown> | undefined
  if (info && typeof info === 'object') return info
  if (raw.unique_id || raw.uniqueId) return raw
  return null
}

export function parseUsersFromSearchUserResponse(
  data: unknown,
  keyword: string,
  dimension: SearchDimension,
): KolCreator[] {
  const root = data as Record<string, unknown>
  const inner = (root.data as Record<string, unknown>) ?? root
  const list =
    (inner.user_list as unknown[]) ??
    (inner.users as unknown[]) ??
    []
  const out: KolCreator[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const u = pickUser(item as Record<string, unknown>)
    if (!u) continue
    const uid = String(u.unique_id ?? u.uniqueId ?? '')
    if (!uid) continue
    const bio = String(u.signature ?? u.bio ?? '')
    out.push({
      unique_id: uid,
      nickname: String(u.nickname ?? ''),
      follower_count: Number(u.follower_count ?? u.followerCount ?? 0),
      video_count: Number(u.aweme_count ?? u.videoCount ?? 0),
      bio,
      email: extractEmail(bio),
      bio_link: null,
      profile_url: `https://www.tiktok.com/@${uid}`,
      search_keyword: keyword,
      dimension,
      best_video_plays: 0,
      best_video_likes: 0,
      best_video_desc: '',
    })
  }
  return out
}

export function parseAuthorsFromVideoSearch(
  data: unknown,
  keyword: string,
  dimension: SearchDimension,
): KolCreator[] {
  const root = data as Record<string, unknown>
  const inner = (root.data as Record<string, unknown>) ?? root
  const items = (inner.data as unknown[]) ?? []
  const out: KolCreator[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const aweme = (row.aweme_info as Record<string, unknown>) ?? row
    const a = aweme.author as Record<string, unknown> | undefined
    if (!a?.unique_id) continue
    const uid = String(a.unique_id)
    const bio = String(a.signature ?? '')
    const plays = Number(
      (aweme.statistics as Record<string, unknown> | undefined)?.play_count ?? 0,
    )
    const likes = Number(
      (aweme.statistics as Record<string, unknown> | undefined)?.digg_count ?? 0,
    )
    out.push({
      unique_id: uid,
      nickname: String(a.nickname ?? ''),
      follower_count: Number(a.follower_count ?? 0),
      video_count: Number(a.aweme_count ?? 0),
      bio,
      email: extractEmail(bio),
      bio_link: null,
      profile_url: `https://www.tiktok.com/@${uid}`,
      search_keyword: keyword,
      dimension,
      best_video_plays: plays,
      best_video_likes: likes,
      best_video_desc: String(aweme.desc ?? '').slice(0, 100),
    })
  }
  return out
}

export function mergeCreator(
  map: Map<string, KolCreator>,
  c: KolCreator,
  followerMin: number,
): void {
  if (c.follower_count < followerMin) return
  const existing = map.get(c.unique_id)
  if (!existing) {
    map.set(c.unique_id, { ...c })
    return
  }
  if (c.best_video_plays > existing.best_video_plays) {
    existing.best_video_plays = c.best_video_plays
    existing.best_video_likes = c.best_video_likes
    existing.best_video_desc = c.best_video_desc
  }
  if (!existing.email && c.email) existing.email = c.email
  if (!existing.bio && c.bio) existing.bio = c.bio
}
