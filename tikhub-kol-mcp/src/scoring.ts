import type { KolCreator } from './types.js'

export type ScoringOptions = {
  categoryKeywords: string[]
  followerMin: number
  followerMax: number
}

const PR_SIGNALS =
  /\b(pr|collab|business|partner|brand|sponsor|email|contact|inquiry|ugc|creator|合作|商务)\b/i

export function scoreCreator(c: KolCreator, opts: ScoringOptions): number {
  let score = 0
  const bio = (c.bio || '').toLowerCase()
  if (c.email) score += 30
  if (
    c.follower_count >= opts.followerMin &&
    c.follower_count <= opts.followerMax
  ) {
    score += 20
  }
  if (opts.categoryKeywords.some((k) => bio.includes(k.toLowerCase()))) score += 15
  if (c.dimension === 'competitor') score += 15
  if (c.video_count > 30) score += 10
  if (c.dimension === 'scene') score += 10
  if (PR_SIGNALS.test(c.bio || '')) score += 10
  if ((c.best_video_plays ?? 0) > 100_000) score += 5
  return score
}

export function tierFromScore(score: number): 'A' | 'B' | 'C' {
  if (score >= 60) return 'A'
  if (score >= 40) return 'B'
  return 'C'
}
