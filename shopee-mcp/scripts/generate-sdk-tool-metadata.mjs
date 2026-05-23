#!/usr/bin/env node
/**
 * 从 @congminh1254/shopee-sdk 的 .d.ts 提取每个 API 方法的 JSDoc 与 Params 字段说明，
 * 生成 src/generated/sdk-tool-metadata.json 供 MCP 注册时填充 inputSchema / description。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "src", "generated");
const OUT_FILE = join(OUT_DIR, "sdk-tool-metadata.json");

const SDK_LIB = join(ROOT, "node_modules", "@congminh1254", "shopee-sdk", "lib");

function camelToSnake(input) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function managerToKebab(managerKey) {
  return camelToSnake(managerKey).replace(/_/g, "-");
}

async function discoverTools() {
  const { ShopeeSDK } = await import(join(SDK_LIB, "sdk.js"));
  const sdk = new ShopeeSDK({ partner_id: 0, partner_key: "__meta__" });
  const SKIP_SDK = new Set([
    "constructor",
    "getConfig",
    "setRegion",
    "setBaseUrl",
    "setFetchAgent",
  ]);
  const SKIP_MGR = new Set(["tokenStorage", "config"]);
  const tools = [];
  const seen = new Set();

  const push = (def) => {
    if (seen.has(def.toolName)) return;
    seen.add(def.toolName);
    tools.push(def);
  };

  const sdkProto = Object.getPrototypeOf(sdk);
  for (const method of Object.getOwnPropertyNames(sdkProto)) {
    if (SKIP_SDK.has(method)) continue;
    const fn = sdk[method];
    if (typeof fn !== "function") continue;
    push({
      manager: "",
      method,
      toolName: `shopee_sdk_${camelToSnake(method)}`,
    });
  }

  for (const [managerKey, manager] of Object.entries(sdk)) {
    if (SKIP_MGR.has(managerKey)) continue;
    const name = manager?.constructor?.name ?? "";
    if (!name.endsWith("Manager")) continue;
    const proto = Object.getPrototypeOf(manager);
    for (const method of Object.getOwnPropertyNames(proto)) {
      if (method === "constructor") continue;
      if (typeof proto[method] !== "function") continue;
      push({
        manager: managerKey,
        method,
        toolName: `shopee_${camelToSnake(managerKey)}_${camelToSnake(method)}`,
      });
    }
  }

  return tools.sort((a, b) => a.toolName.localeCompare(b.toolName));
}

/** @param {string} content */
function extractJsDocBefore(content, methodName) {
  const lines = content.split("\n");
  const sig = `    ${methodName}(`;
  let sigIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(sig)) {
      sigIdx = i;
      break;
    }
  }
  if (sigIdx < 0) return "";

  const docLines = [];
  for (let i = sigIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (line.trim().startsWith("*") || line.trim().startsWith("/**")) {
      docLines.unshift(line);
      if (line.trim().startsWith("/**")) break;
    } else break;
  }

  return docLines
    .join("\n")
    .replace(/^\/\*\*\s?/m, "")
    .replace(/\s?\*\/\s*$/m, "")
    .replace(/^\s*\*\s?/gm, "")
    .trim();
}

/** @param {string} sigInner */
function parseSignatureParams(sigInner) {
  const trimmed = sigInner.trim();
  if (!trimmed) return { paramsType: null, paramsOptional: true };
  const m = trimmed.match(/^params\??:\s*(\w+)/);
  if (m) return { paramsType: m[1], paramsOptional: trimmed.includes("params?:") };
  return { paramsType: null, paramsOptional: true };
}

/** @param {string} content @param {string} methodName */
function parseMethodFromManager(content, methodName) {
  const re = new RegExp(`\\s+${methodName}\\(([^)]*)\\)\\s*:\\s*Promise<`, "m");
  const m = content.match(re);
  if (!m) return { summary: "", paramsType: null, paramsOptional: true };
  const summary = extractJsDocBefore(content, methodName);
  const { paramsType, paramsOptional } = parseSignatureParams(m[1]);
  return { summary, paramsType, paramsOptional };
}

/** @param {string} content @param {string} typeName */
function parseExportTypeFields(content, typeName) {
  const anchor = new RegExp(
    `export (?:type|interface) ${typeName}\\s*(?:=\\s*)?\\{`
  );
  const match = anchor.exec(content);
  if (!match) return [];

  let i = match.index + match[0].length;
  let depth = 1;
  const bodyStart = i;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  const body = content.slice(bodyStart, i - 1);

  const fields = [];
  let pendingDesc = "";
  for (const line of body.split("\n")) {
    const doc = line.match(/^\s*\/\*\*\s*(.+?)\s*\*\/\s*$/);
    if (doc) {
      pendingDesc = doc[1].trim();
      continue;
    }
    const field = line.match(/^\s*(\w+)(\?)?:\s*([^;]+);/);
    if (!field) continue;
    fields.push({
      name: field[1],
      required: !field[2],
      type: field[3].trim(),
      description: pendingDesc,
    });
    pendingDesc = "";
  }
  return fields;
}

const SDK_ROOT_PARAM_SCHEMAS = {
  getAuthorizationUrl: {
    summary: "Get OAuth authorization URL",
    paramsOptional: false,
    fields: [
      {
        name: "redirect_uri",
        required: true,
        type: "string",
        description: "OAuth redirect URI",
      },
    ],
  },
  authenticateWithCode: {
    summary: "Exchange authorization code for access token",
    paramsOptional: false,
    fields: [
      { name: "code", required: true, type: "string", description: "OAuth code" },
      {
        name: "shop_id",
        required: false,
        type: "number",
        description: "Shop ID (alias shopId)",
      },
      {
        name: "main_account_id",
        required: false,
        type: "number",
        description: "Main account ID (alias mainAccountId)",
      },
    ],
  },
  getAuthToken: {
    summary: "Get stored auth token",
    paramsOptional: true,
    fields: [],
  },
  refreshToken: {
    summary: "Refresh access token",
    paramsOptional: true,
    fields: [
      { name: "shop_id", required: false, type: "number", description: "Shop ID" },
      {
        name: "merchant_id",
        required: false,
        type: "number",
        description: "Merchant ID",
      },
    ],
  },
};

async function buildMetadata() {
  const tools = await discoverTools();
  /** @type {Record<string, object>} */
  const meta = {};
  let withFields = 0;

  for (const def of tools) {
    let summary = "";
    let paramsType = null;
    let paramsOptional = true;
    /** @type {Array<{name:string,required:boolean,type:string,description:string}>} */
    let fields = [];

    if (!def.manager) {
      const root = SDK_ROOT_PARAM_SCHEMAS[def.method];
      if (root) {
        summary = root.summary;
        paramsOptional = root.paramsOptional;
        fields = root.fields;
      }
    } else {
      const mgrFile = join(
        SDK_LIB,
        "managers",
        `${managerToKebab(def.manager)}.manager.d.ts`
      );
      const schemaFile = join(
        SDK_LIB,
        "schemas",
        `${managerToKebab(def.manager)}.d.ts`
      );
      if (existsSync(mgrFile)) {
        const mgrContent = readFileSync(mgrFile, "utf8");
        const parsed = parseMethodFromManager(mgrContent, def.method);
        summary = parsed.summary;
        paramsType = parsed.paramsType;
        paramsOptional = parsed.paramsOptional;
      }
      if (paramsType && existsSync(schemaFile)) {
        const schemaContent = readFileSync(schemaFile, "utf8");
        fields = parseExportTypeFields(schemaContent, paramsType);
      }
    }

    if (fields.length > 0) withFields++;

    meta[def.toolName] = {
      manager: def.manager,
      method: def.method,
      sdkPath: def.manager
        ? `sdk.${def.manager}.${def.method}(params)`
        : `ShopeeSDK.${def.method}(params)`,
      summary: summary || undefined,
      paramsType: paramsType || undefined,
      paramsOptional,
      fields,
    };
  }

  return { tools: meta, stats: { total: tools.length, withFields } };
}

async function main() {
  const { tools, stats } = await buildMetadata();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({ version: 1, tools }, null, 0));
  console.error(
    `[generate-sdk-tool-metadata] wrote ${OUT_FILE} (${stats.total} tools, ${stats.withFields} with param fields)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
