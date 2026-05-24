export type SearchDimension = 'category' | 'scene' | 'competitor' | 'audience'

export type SearchTask = {
  keyword: string
  dimension: SearchDimension
}

export type KolCreator = {
  unique_id: string
  nickname: string
  follower_count: number
  video_count: number
  bio: string
  email: string | null
  bio_link: string | null
  profile_url: string
  search_keyword: string
  dimension: SearchDimension
  best_video_plays: number
  best_video_likes: number
  best_video_desc: string
  priority_score?: number
  tier?: 'A' | 'B' | 'C'
  has_email?: boolean
  bio_category_match?: boolean
}

export type BatchSourcingInput = {
  product_label: string
  search_tasks: SearchTask[]
  category_keywords?: string[]
  follower_min?: number
  follower_max?: number
  target_total?: number
  max_pages_per_keyword?: number
  enrich_profiles?: boolean
  search_mode?: 'videos' | 'users'
}

export type BatchSourcingResult = {
  product_label: string
  total_raw: number
  total_exported: number
  tier_a: number
  tier_b: number
  tier_c: number
  with_email: number
  csv_path: string
  keyword_stats: Record<string, number>
  top_creators: Array<{
    tier: string
    score: number
    username: string
    followers: number
    email: string | null
    keyword: string
  }>
}
