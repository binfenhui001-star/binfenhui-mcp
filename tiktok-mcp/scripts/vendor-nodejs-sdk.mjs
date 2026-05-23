#!/usr/bin/env node
/**
 * Copy TikTok nodejs_sdk into mcp/tiktok-mcp/vendor/nodejs_sdk for bundling (like shopee npm deps).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSdkRoot } from "./resolve-sdk-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIKTOK_MCP_ROOT = join(__dirname, "..");
const DEST = join(TIKTOK_MCP_ROOT, "vendor", "nodejs_sdk");

function main() {
  if (existsSync(join(DEST, "index.ts"))) {
    const src = resolveSdkRoot(TIKTOK_MCP_ROOT);
    if (resolve(src) === resolve(DEST)) {
      console.log(`[vendor-nodejs-sdk] already vendored at ${DEST}`);
      return;
    }
    console.log(`[vendor-nodejs-sdk] refresh from ${src} → ${DEST}`);
    rmSync(DEST, { recursive: true, force: true });
  }

  const source = resolveSdkRoot(TIKTOK_MCP_ROOT);
  if (resolve(source) === resolve(DEST)) {
    console.log(`[vendor-nodejs-sdk] source is dest, skip`);
    return;
  }

  mkdirSync(join(TIKTOK_MCP_ROOT, "vendor"), { recursive: true });
  console.log(`[vendor-nodejs-sdk] copying ${source} → ${DEST} ...`);
  const t0 = Date.now();
  cpSync(source, DEST, { recursive: true });
  console.log(
    `[vendor-nodejs-sdk] done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${DEST}`
  );
}

main();
