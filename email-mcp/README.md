# email-mcp（缤纷汇内置）

基于 [RickyQzh/email_mcp](https://github.com/RickyQzh/email_mcp) 的 stdio MCP，支持 **多邮箱账号**。

## 账号配置

在桌面端 **设置 → 通用 → 邮箱账号** 添加；会同步到：

`~/.Claude/email-mcp-accounts.json`

## 依赖

桌面安装包已内置 `bin/uv` 与 `.venv`（构建时 `build:sidecars` 自动下载并 `uv sync`）。

本地开发：

```bash
cd mcp/email-mcp
uv sync
# 或: pip install -r requirements.txt
```

## 本地调试

```bash
export EMAIL_MCP_ACCOUNTS_FILE=~/.Claude/email-mcp-accounts.json
uv run python stdio_server.py
```

## MCP 工具

| 工具 | 说明 |
|------|------|
| `email_list_accounts` | 列出已配置账号 |
| `get_newest_email` | 最新未读邮件 |
| `check_emails` | 批量检查邮件 |
| `save_attachment` | 保存附件 |
| `send_text_email` | 发送纯文本 |
| `send_html_email` | 发送 HTML |
| `send_email_with_attachment` | 发送带附件 |

多账号时除 `email_list_accounts` 外需传 `account_id`；单账号可省略。
