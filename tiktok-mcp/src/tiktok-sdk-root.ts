import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function getTiktokMcpRoot(): string {
  return join(here, "..");
}

const VENDORED_SDK = () => join(getTiktokMcpRoot(), "vendor", "nodejs_sdk");

function hasSdkIndex(dir: string): boolean {
  return existsSync(join(dir, "index.ts"));
}

/** 项目内 vendored SDK（随 tiktok-mcp 打包） */
export function getVendoredTiktokSdkRoot(): string {
  return VENDORED_SDK();
}

export function isVendoredTiktokSdkPresent(): boolean {
  return hasSdkIndex(getVendoredTiktokSdkRoot());
}

/**
 * TikTok Shop OpenAPI SDK 目录。
 * 优先级：TIKTOK_SDK_ROOT → vendor/nodejs_sdk（项目内）→ 历史外部路径。
 */
export function resolveTiktokSdkRoot(): string {
  const fromEnv = process.env.TIKTOK_SDK_ROOT?.trim();
  if (fromEnv && hasSdkIndex(fromEnv)) {
    return resolve(fromEnv);
  }

  const vendored = getVendoredTiktokSdkRoot();
  if (hasSdkIndex(vendored)) {
    return vendored;
  }

  const mcpRoot = getTiktokMcpRoot();
  const legacyCandidates = [
    resolve(mcpRoot, "..", "..", "..", "nodejs_sdk"),
    resolve(mcpRoot, "..", "..", "..", "..", "nodejs_sdk"),
    join(homedir(), "Documents", "nodejs_sdk"),
    join(homedir(), "nodejs_sdk"),
  ];

  for (const dir of legacyCandidates) {
    if (hasSdkIndex(dir)) {
      return dir;
    }
  }

  throw new Error(
    "找不到 TikTok SDK：请完整克隆 mcp 仓库（含 vendor/nodejs_sdk），或设置 TIKTOK_SDK_ROOT 后运行 npm run vendor:sdk"
  );
}
