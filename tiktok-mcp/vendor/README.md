# TikTok Shop `nodejs_sdk`（vendor）

与 Shopee 的 `@congminh1254/shopee-sdk` 类似，官方 SDK  vendoring 在此目录，随 `tiktok-mcp` 打进桌面应用。

```bash
cd mcp/tiktok-mcp
npm run vendor:sdk    # 从 TIKTOK_SDK_ROOT 或 ~/Documents/nodejs_sdk 复制到 vendor/nodejs_sdk
npm run build         # 会先生成 catalog 再 tsc
```

`vendor/nodejs_sdk/` 已加入 `.gitignore`（约 70MB）。CI/打包前需执行 `vendor:sdk`。
