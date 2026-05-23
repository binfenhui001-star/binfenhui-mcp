# TikTok Shop `nodejs_sdk`（随仓库提交）

官方 TikTok Shop Open API **nodejs_sdk** 已 vendoring 在本目录，**克隆仓库即可构建**，无需本机 `~/Documents/nodejs_sdk` 或 `TIKTOK_SDK_ROOT`。

```bash
cd mcp/tiktok-mcp
npm ci
npm run build   # 若 vendor 已存在则跳过复制，仅生成 catalog + tsc
```

维护者从外部 SDK 刷新 vendor（可选）：

```bash
export TIKTOK_SDK_ROOT=/path/to/nodejs_sdk   # 或放在 ~/Documents/nodejs_sdk
npm run vendor:sdk
```

`npm run vendor:sdk` 仅在 `vendor/nodejs_sdk` 缺失，或需从更新的本地 SDK 覆盖时才会复制。
