#!/usr/bin/env node
/**
 * Resolve TikTok Shop nodejs_sdk directory (vendor-first, same rules as src/tiktok-sdk-root.ts).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * @param {string} tiktokMcpRoot - mcp/tiktok-mcp directory
 */
export function resolveSdkRoot(tiktokMcpRoot) {
  const fromEnv = process.env.TIKTOK_SDK_ROOT?.trim();
  if (fromEnv && existsSync(join(fromEnv, "index.ts"))) {
    return resolve(fromEnv);
  }

  const vendored = join(tiktokMcpRoot, "vendor", "nodejs_sdk");
  if (existsSync(join(vendored, "index.ts"))) {
    return vendored;
  }

  const documentsSdk = resolve(
    tiktokMcpRoot,
    "..",
    "..",
    "..",
    "..",
    "nodejs_sdk"
  );
  if (existsSync(join(documentsSdk, "index.ts"))) {
    return documentsSdk;
  }

  for (const dir of [
    join(homedir(), "Documents", "nodejs_sdk"),
    join(homedir(), "nodejs_sdk"),
  ]) {
    if (existsSync(join(dir, "index.ts"))) {
      return dir;
    }
  }

  throw new Error(
    "找不到 TikTok nodejs_sdk。请运行: npm run vendor:sdk（或设置 TIKTOK_SDK_ROOT）"
  );
}
