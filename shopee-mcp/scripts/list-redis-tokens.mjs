#!/usr/bin/env node
/** 列出 Redis 中 shopee:token:{main_id}:{shop_id} 及摘要（不打印完整 access_token） */
import { Redis } from 'ioredis'

const host = process.env.REDIS_HOST?.trim() || '127.0.0.1'
const port = Number(process.env.REDIS_PORT || 6379)
const password = process.env.REDIS_PASS?.trim() || undefined
const db = Number(process.env.REDIS_DB || 0)

const redis = new Redis({ host, port, password, db, maxRetriesPerRequest: 1, connectTimeout: 5000 })

try {
  await redis.ping()
} catch (e) {
  console.error(`无法连接 Redis ${host}:${port} db=${db}:`, e.message)
  process.exit(1)
}

const pattern = process.argv[2] || 'shopee:token:*'
const keys = await redis.keys(pattern)

if (keys.length === 0) {
  console.log(`未找到键（pattern=${pattern}）`)
  console.log('期望格式: shopee:token:{main_id}:{shop_id}')
  await redis.quit()
  process.exit(0)
}

console.log(`共 ${keys.length} 个 token 键:\n`)
for (const key of keys.sort()) {
  const raw = await redis.get(key)
  const ttl = await redis.ttl(key)
  const parts = key.split(':')
  const mainId = parts[2]
  const shopId = parts[3]
  let summary = { main_id: mainId, shop_id: shopId, ttl_seconds: ttl }
  if (raw) {
    try {
      const t = JSON.parse(raw)
      summary = {
        ...summary,
        has_access_token: Boolean(t.access_token),
        has_refresh_token: Boolean(t.refresh_token),
        access_token_preview: t.access_token ? `${String(t.access_token).slice(0, 8)}…` : null,
        expired_at: t.expired_at ?? null,
        expire_in: t.expire_in ?? null,
      }
    } catch {
      summary.parse_error = true
    }
  } else {
    summary.empty = true
  }
  console.log(key)
  console.log(JSON.stringify(summary, null, 2))
  console.log('')
}

console.log('调用 MCP 时传入对应的 main_id、shop_id 即可，无需手动复制 token。')
await redis.quit()
