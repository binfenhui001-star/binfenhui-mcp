#!/usr/bin/env node
/**
 * Scan TikTok Shop nodejs_sdk API .ts files and emit catalog + metadata JSON.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSdkRoot } from "./resolve-sdk-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "src", "generated");

function camelToSnake(input) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function apiClientToSlug(apiClient) {
  const base = apiClient.endsWith("Api") ? apiClient.slice(0, -3) : apiClient;
  return camelToSnake(base);
}

function parseApiClients(apisTs) {
  const keys = [];
  for (const m of apisTs.matchAll(/^\s+(\w+Api):/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

function parseMethodSignature(inner) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  return parts.map((chunk) => {
    const opt = chunk.includes("?:");
    const nameMatch = chunk.match(/^(\w+)\??\s*:/);
    const typeMatch = chunk.match(/:\s*([^=]+?)(?:\s*=|$)/);
    const name = nameMatch?.[1] ?? "unknown";
    let type = typeMatch?.[1]?.trim() ?? "unknown";
    if (type.includes("{headers")) type = "object";
    return { name, required: !opt, type };
  });
}

function extractMethods(apiFileContent) {
  const methods = [];
  const re = /\/\*\*([\s\S]*?)\*\/\s*public async (\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(apiFileContent)) !== null) {
    const doc = m[1]
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    const summary = doc.split("@summary")[1]?.split("@")[0]?.trim() || doc.slice(0, 200);
    methods.push({
      method: m[2],
      summary,
      positionalParams: parseMethodSignature(m[3]),
    });
  }
  return methods;
}

function needsShopAuth(apiClient) {
  return !apiClient.startsWith("Authorization");
}

/** 扫描 model 下所有 RequestBody.ts，建立类型名 → 字段列表索引 */
function buildRequestBodyIndex(sdkRoot) {
  const index = {};
  const modelRoot = join(sdkRoot, "model");

  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
        continue;
      }
      if (!ent.name.endsWith("RequestBody.ts")) continue;
      const content = readFileSync(p, "utf8");
      const classMatch = content.match(/export class (\w+)/);
      if (!classMatch) continue;
      const fields = [];
      const mapBlock = content.match(
        /attributeTypeMap:\s*Array<[^>]+>\s*=\s*\[([\s\S]*?)\];/
      );
      if (mapBlock) {
        const entryRe =
          /\{\s*"name":\s*"([^"]+)"[\s\S]*?"baseName":\s*"([^"]+)"[\s\S]*?"type":\s*"([^"]+)"/g;
        let fm;
        while ((fm = entryRe.exec(mapBlock[1])) !== null) {
          fields.push({ name: fm[1], baseName: fm[2], type: fm[3] });
        }
      }
      index[classMatch[1]] = fields;
    }
  }

  if (existsSync(modelRoot)) walk(modelRoot);
  return index;
}

function attachRequestBodyMeta(positionalParams, requestBodyIndex) {
  for (const param of positionalParams) {
    if (
      !param.name.endsWith("RequestBody") &&
      !param.type.includes("RequestBody")
    ) {
      continue;
    }
    const fields = requestBodyIndex[param.type];
    if (fields?.length) {
      return {
        paramName: param.name,
        type: param.type,
        fields,
      };
    }
  }
  return undefined;
}

function main() {
  const sdkRoot = resolveSdkRoot(ROOT);
  const apisPath = join(sdkRoot, "api", "apis.ts");
  const apiDir = join(sdkRoot, "api");
  const apiClients = parseApiClients(readFileSync(apisPath, "utf8"));

  const requestBodyIndex = buildRequestBodyIndex(sdkRoot);
  const catalog = [];
  const metadata = {};
  const seen = new Set();

  for (const apiClient of apiClients) {
    const file = join(apiDir, `${apiClient.charAt(0).toLowerCase()}${apiClient.slice(1)}.ts`);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const methods = extractMethods(content);
    const apiSlug = apiClientToSlug(apiClient);

    for (const entry of methods) {
      const methodSlug = camelToSnake(entry.method);
      const toolName = `tiktok_${apiSlug}_${methodSlug}`;
      if (seen.has(toolName)) continue;
      seen.add(toolName);

      catalog.push({ toolName, apiClient, method: entry.method });
      const requestBody = attachRequestBodyMeta(
        entry.positionalParams,
        requestBodyIndex
      );
      metadata[toolName] = {
        apiClient,
        method: entry.method,
        sdkPath: `api.${apiClient}.${entry.method}`,
        summary: entry.summary,
        positionalParams: entry.positionalParams,
        needsShopAuth: needsShopAuth(apiClient),
        ...(requestBody ? { requestBody } : {}),
      };
    }
  }

  catalog.sort((a, b) => a.toolName.localeCompare(b.toolName));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "sdk-tool-catalog.json"), JSON.stringify(catalog, null, 2));
  writeFileSync(join(OUT, "sdk-tool-metadata.json"), JSON.stringify(metadata, null, 2));
  console.log(
    `[generate-catalog] SDK=${sdkRoot} tools=${catalog.length} -> ${OUT}`
  );
}

main();
