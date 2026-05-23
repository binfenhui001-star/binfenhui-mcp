#!/usr/bin/env node
/**
 * 审计 sdk-tool-metadata.json：统计字段命名风格、枚举类型、无字段工具。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(
  readFileSync(join(ROOT, "src/generated/sdk-tool-metadata.json"), "utf8")
);

let camelFields = 0;
let snakeFields = 0;
let enumTypes = new Set();
let noFields = 0;

for (const [toolName, tool] of Object.entries(meta.tools)) {
  if (!tool.fields?.length) {
    noFields++;
    continue;
  }
  for (const f of tool.fields) {
    if (f.name.includes("_")) snakeFields++;
    else if (/[A-Z]/.test(f.name)) camelFields++;
    const t = f.type.trim();
    if (!["number", "string", "boolean", "number[]", "string[]"].includes(t)) {
      enumTypes.add(t);
    }
  }
}

console.log("[audit-sdk-params] tools:", Object.keys(meta.tools).length);
console.log("[audit-sdk-params] tools without parsed fields:", noFields);
console.log("[audit-sdk-params] snake_case field names:", snakeFields);
console.log("[audit-sdk-params] camelCase field names:", camelFields);
console.log("[audit-sdk-params] distinct enum-like types:", enumTypes.size);
