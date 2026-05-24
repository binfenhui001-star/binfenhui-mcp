# tikhub-kol-mcp

TikTok **红人建联** MCP 服务，封装 [waynefu2020/tikhub-kol-sourcing](https://github.com/waynefu2020/tikhub-kol-sourcing) 的 TikHub 采集与 A/B/C 评分逻辑，供缤纷汇 / Claude Code 通过 stdio 调用。

## 配置

```bash
cp .env.example .env
# 或在仓库根 mcp/.env 中设置：
# TIKHUB_API_KEY=...
```

在 [tikhub.io](https://tikhub.io) 注册获取 API Key。

## 构建与运行

```bash
npm ci
npm run build
node --env-file=../.env dist/mcp-server.js
```

## MCP 工具

| 工具 | 说明 |
|------|------|
| `kol_tikhub_ping` | 验证 API Key |
| `kol_search_users` | 单次关键词搜用户（TikHub `fetch_search_user`） |
| `kol_batch_sourcing` | 多关键词批量采集 → 评分 → UTF-8 BOM CSV |
| `kol_output_dir` | 查看 CSV 输出目录 |

### `kol_batch_sourcing` 示例参数

```json
{
  "product_label": "powerbank-ph",
  "search_tasks": [
    { "keyword": "power bank review", "dimension": "category" },
    { "keyword": "travel essentials tech", "dimension": "scene" }
  ],
  "category_keywords": ["power", "charger", "anker"],
  "search_mode": "videos",
  "target_total": 30
}
```

默认输出：`~/.Claude/kol-sourcing/output/kol-{label}-{timestamp}.csv`

## Skill 工作流

同目录 `skill/` 为上游 Skill 副本（5 Phase 产品诊断 → 关键词 → 采集 → 建联建议）。Agent 可结合 MCP 工具执行 Phase 4 自动化，无需每次手写 `tsx` 脚本。

## 上游

- 项目：https://github.com/waynefu2020/tikhub-kol-sourcing  
- 官网：https://tikhub-kol-sourcing.vercel.app  

## License

MIT（MCP 封装）；上游 Skill 遵循其仓库许可。
