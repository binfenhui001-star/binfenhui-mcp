import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 必须在加载 sdk-tool-catalog（会 new ShopeeSDK）之前执行。
 * 桌面 .app 子进程 cwd 可能为 /，SDK 会在 cwd/.token 建目录并崩溃。
 */
export function bootstrapShopeeMcpProcess(): void {
  if (!process.env.HOME?.trim()) {
    process.env.HOME = homedir();
  }

  const candidates: string[] = [];
  const fromEnv = process.env.SHOPEE_MCP_ROOT?.trim();
  if (fromEnv) candidates.push(fromEnv);

  const distDir = dirname(fileURLToPath(import.meta.url));
  candidates.push(join(distDir, ".."));

  for (const dir of candidates) {
    if (!dir || !existsSync(dir)) continue;
    try {
      process.chdir(dir);
      return;
    } catch {
      // try next
    }
  }
}

bootstrapShopeeMcpProcess();
