#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'

import { getOutputDir } from './config.js'
import { runBatchSourcing } from './sourcing.js'
import { tikhubFetch, tikhubPing } from './tikhub-client.js'
import { parseUsersFromSearchUserResponse } from './parse-response.js'
import type { SearchDimension } from './types.js'

const searchTaskSchema = z.object({
  keyword: z.string().min(1),
  dimension: z
    .enum(['category', 'scene', 'competitor', 'audience'])
    .default('category'),
})

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'tikhub-kol-mcp', version: '1.0.0' },
    {
      instructions: `TikTok 红人建联 MCP（基于 waynefu2020/tikhub-kol-sourcing）。
流程：kol_tikhub_ping 验证密钥 → kol_batch_sourcing 批量采集并输出 CSV（~/.Claude/kol-sourcing/output）。
推荐 search_mode=videos；关键词用内容词（如 "juicer review"）而非纯产品型号。
需 TIKHUB_API_KEY（mcp/.env）。`,
    },
  )

  server.registerTool(
    'kol_tikhub_ping',
    {
      title: '验证 TikHub API Key',
      description: '检查 TIKHUB_API_KEY 是否有效（轻量请求）。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      const result = await tikhubPing()
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  server.registerTool(
    'kol_search_users',
    {
      title: '按关键词搜索 TikTok 用户',
      description:
        '调用 TikHub fetch_search_user。返回用户列表 JSON（不含评分 CSV）。',
      inputSchema: z.object({
        keyword: z.string().min(1),
        cursor: z.number().int().min(0).default(0),
        max_results: z.number().int().min(1).max(50).default(20),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      const data = await tikhubFetch('/api/v1/tiktok/web/fetch_search_user', {
        keyword: args.keyword,
        cursor: args.cursor,
      })
      const users = parseUsersFromSearchUserResponse(
        data,
        args.keyword,
        'category' as SearchDimension,
      ).slice(0, args.max_results)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ keyword: args.keyword, count: users.length, users }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    'kol_batch_sourcing',
    {
      title: '批量采集红人并导出 CSV',
      description:
        '多关键词搜索、去重、可选 Profile 补全邮箱、A/B/C 评分，写入输出目录 UTF-8 BOM CSV。',
      inputSchema: z.object({
        product_label: z.string().min(1).describe('产品/任务标签，用于文件名'),
        search_tasks: z.array(searchTaskSchema).min(1).max(10),
        category_keywords: z
          .array(z.string())
          .optional()
          .describe('bio 品类匹配词，用于 +15 分'),
        follower_min: z.number().int().min(0).default(5000),
        follower_max: z.number().int().default(5_000_000),
        target_total: z.number().int().min(1).max(200).default(50),
        max_pages_per_keyword: z.number().int().min(1).max(10).default(4),
        enrich_profiles: z.boolean().default(true),
        search_mode: z.enum(['videos', 'users']).default('videos'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const result = await runBatchSourcing({
        product_label: args.product_label,
        search_tasks: args.search_tasks,
        category_keywords: args.category_keywords,
        follower_min: args.follower_min,
        follower_max: args.follower_max,
        target_total: args.target_total,
        max_pages_per_keyword: args.max_pages_per_keyword,
        enrich_profiles: args.enrich_profiles,
        search_mode: args.search_mode,
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...result,
                output_dir: getOutputDir(),
                scoring: 'A≥60 B≥40 C<40 (see outreach-scoring in skill/)',
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  server.registerTool(
    'kol_output_dir',
    {
      title: '查看 CSV 输出目录',
      description: '返回当前 TIKHUB_KOL_OUTPUT_DIR 或默认 ~/.Claude/kol-sourcing/output',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => ({
      content: [{ type: 'text', text: getOutputDir() }],
    }),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[tikhub-kol-mcp] stdio ready')
}

main().catch((err: unknown) => {
  console.error('[tikhub-kol-mcp] fatal:', err)
  process.exit(1)
})
