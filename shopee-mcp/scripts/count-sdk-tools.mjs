#!/usr/bin/env node
import { discoverSdkToolDefinitions } from "../dist/sdk-tool-catalog.js";

const tools = discoverSdkToolDefinitions();
const byManager = {};
for (const t of tools) {
  const k = t.manager || "_sdk";
  byManager[k] = (byManager[k] ?? 0) + 1;
}
console.log("total", tools.length);
console.log("by manager:", byManager);
console.log("sample order tools:");
for (const t of tools.filter((x) => x.manager === "order").slice(0, 5)) {
  console.log(" ", t.toolName);
}
