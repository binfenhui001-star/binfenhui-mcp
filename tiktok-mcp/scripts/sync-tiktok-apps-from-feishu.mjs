#!/usr/bin/env node
/**
 * 从飞书多维表格同步 TikTok app_key / app_secret 到 mcp/.env（TIKTOK_APPS JSON + 默认项）
 *
 * 用法:
 *   node scripts/sync-tiktok-apps-from-feishu.mjs
 *   node scripts/sync-tiktok-apps-from-feishu.mjs --csv /path/to/export.csv
 *
 * 环境变量（或 ~/.Claude/adapters.json 中的 feishu.appId/appSecret）:
 *   FEISHU_APP_ID, FEISHU_APP_SECRET
 *
 * 表格（可覆盖）:
 *   FEISHU_BITABLE_APP_TOKEN=BKC0bESRfaaGQtsybdOcGutRnMd
 *   FEISHU_BITABLE_TABLE_ID=tblN3c2RftjWLciP
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ENV = resolve(__dirname, "../../.env");
const DEFAULT_BASE = "BKC0bESRfaaGQtsybdOcGutRnMd";
const DEFAULT_TABLE = "tblN3c2RftjWLciP";
const FEISHU_API = "https://open.feishu.cn/open-apis";

function loadFeishuCredentials() {
  const id = process.env.FEISHU_APP_ID?.trim();
  const secret = process.env.FEISHU_APP_SECRET?.trim();
  if (id && secret) return { appId: id, appSecret: secret };

  const adaptersPath = join(homedir(), ".Claude", "adapters.json");
  if (existsSync(adaptersPath)) {
    const adapters = JSON.parse(readFileSync(adaptersPath, "utf8"));
    const fs = adapters?.feishu;
    if (fs?.appId && fs?.appSecret) {
      return { appId: fs.appId, appSecret: fs.appSecret };
    }
  }
  throw new Error("缺少 FEISHU_APP_ID / FEISHU_APP_SECRET（或 ~/.Claude/adapters.json feishu 节点）");
}

async function getTenantToken(creds) {
  const res = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: ${JSON.stringify(data)}`);
  }
  return data.tenant_access_token;
}

async function listFields(token, appToken, tableId) {
  const url = `${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`读取字段失败: ${data.msg || JSON.stringify(data)}`);
  }
  return data.data?.items ?? [];
}

async function listAllRecords(token, appToken, tableId) {
  const records = [];
  let pageToken;
  do {
    const url = new URL(
      `${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`
    );
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`读取记录失败: ${data.msg || JSON.stringify(data)}`);
    }
    records.push(...(data.data?.items ?? []));
    pageToken = data.data?.page_token;
  } while (pageToken);
  return records;
}

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pickFieldId(fields, candidates) {
  for (const f of fields) {
    const name = norm(f.field_name);
    if (candidates.some((c) => name === norm(c) || name.includes(norm(c)))) {
      return f.field_id;
    }
  }
  return null;
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "object" && v?.text ? v.text : String(v)))
      .join("")
      .trim();
  }
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
}

function recordsToApps(records, fields) {
  const keyId = pickFieldId(fields, [
    "app_key",
    "appkey",
    "App Key",
    "APP_KEY",
    "应用key",
  ]);
  const secretId = pickFieldId(fields, [
    "app_secret",
    "appsecret",
    "App Secret",
    "APP_SECRET",
    "密钥",
    "secret",
  ]);
  const labelId = pickFieldId(fields, [
    "label",
    "名称",
    "应用名",
    "店铺",
    "备注",
    "name",
    "alias",
  ]);
  const redirectId = pickFieldId(fields, ["redirect_uri", "回调", "redirect"]);

  if (!keyId) {
    throw new Error(
      `未找到 app_key 列。字段: ${fields.map((f) => f.field_name).join(", ")}`
    );
  }

  const apps = [];
  for (const rec of records) {
    const row = rec.fields ?? {};
    const app_key = cellText(row[keyId]);
    if (!app_key) continue;
    const app_secret = secretId ? cellText(row[secretId]) : "";
    const labelRaw = labelId ? cellText(row[labelId]) : "";
    const label =
      labelRaw ||
      app_key.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "_") ||
      `app_${apps.length + 1}`;
    apps.push({
      label: label.replace(/\s+/g, "_"),
      app_key,
      app_secret,
      redirect_uri: redirectId ? cellText(row[redirectId]) || undefined : undefined,
    });
  }
  return apps;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const apps = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row = Object.fromEntries(headers.map((h, j) => [h, cols[j] ?? ""]));
    const app_key =
      row.app_key || row.App_Key || row.APP_KEY || row["App Key"] || "";
    const app_secret =
      row.app_secret || row.App_Secret || row.APP_SECRET || row["App Secret"] || "";
    if (!app_key) continue;
    apps.push({
      label: (row.label || row.名称 || row.name || app_key).replace(/\s+/g, "_"),
      app_key,
      app_secret,
      redirect_uri: row.redirect_uri || row.回调 || undefined,
    });
  }
  return apps;
}

function updateMcpEnv(apps) {
  if (apps.length === 0) throw new Error("没有可写入的应用");

  const deduped = [];
  const seen = new Set();
  for (const a of apps) {
    if (seen.has(a.app_key)) continue;
    seen.add(a.app_key);
    deduped.push(a);
  }

  let envText = existsSync(MCP_ENV) ? readFileSync(MCP_ENV, "utf8") : "";

  const first = deduped[0];
  const block = [
    "# TikTok Shop Open API（由飞书多维表格 sync 生成）",
    `TIKTOK_APP_KEY=${first.app_key}`,
    `TIKTOK_APP_SECRET=${first.app_secret}`,
    `TIKTOK_APP_LABEL=${first.label}`,
    "TIKTOK_ENVIRONMENT=live",
    first.redirect_uri ? `TIKTOK_REDIRECT_URI=${first.redirect_uri}` : "TIKTOK_REDIRECT_URI=",
    "",
    `TIKTOK_APPS=${JSON.stringify(deduped)}`,
    "",
  ].join("\n");

  if (/^# TikTok Shop Open API/m.test(envText)) {
    envText = envText.replace(
      /^# TikTok Shop Open API[\s\S]*?(?=\n# |\n[A-Z_]+=|\n*$)/m,
      block.trimEnd() + "\n"
    );
  } else {
    envText = envText.trimEnd() + "\n\n" + block;
  }

  writeFileSync(MCP_ENV, envText.endsWith("\n") ? envText : envText + "\n", "utf8");
  console.log(`已写入 ${deduped.length} 个应用到 ${MCP_ENV}`);
  for (const a of deduped) {
    console.log(`  - ${a.label}: ${a.app_key} secret=${a.app_secret ? "***" : "(空)"}`);
  }
}

async function main() {
  const csvIdx = process.argv.indexOf("--csv");
  if (csvIdx >= 0) {
    const path = process.argv[csvIdx + 1];
    if (!path) throw new Error("--csv 需要文件路径");
    const apps = parseCsv(readFileSync(resolve(path), "utf8"));
    updateMcpEnv(apps);
    return;
  }

  const creds = loadFeishuCredentials();
  const token = await getTenantToken(creds);
  const appToken =
    process.env.FEISHU_BITABLE_APP_TOKEN?.trim() || DEFAULT_BASE;
  const tableId =
    process.env.FEISHU_BITABLE_TABLE_ID?.trim() || DEFAULT_TABLE;

  const fields = await listFields(token, appToken, tableId);
  const records = await listAllRecords(token, appToken, tableId);
  const apps = recordsToApps(records, fields);
  updateMcpEnv(apps);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
