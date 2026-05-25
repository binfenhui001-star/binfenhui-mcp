# 缤纷汇内置说明

本目录为 [GeLi2001/shopify-mcp](https://github.com/GeLi2001/shopify-mcp) 的 vendored 副本，纳入官方 [binfenhui-mcp](https://github.com/binfenhui001-star/binfenhui-mcp) 套件。

## 配置

在套件根目录 `mcp/.env`（或 `~/.Claude/mcp/.env`）填写：

```env
SHOPIFY_ACCESS_TOKEN=shpat_...
MYSHOPIFY_DOMAIN=your-store.myshopify.com
```

## 构建

```bash
npm ci && npm run build
```

桌面端 / 一键 GitHub 安装会自动执行上述步骤。
