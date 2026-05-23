import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function applyEnvFile(path: string, onlyIfUnset: boolean): void {
  if (!existsSync(path)) return;
  let parsed: Record<string, string>;
  try {
    parsed = parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!value) continue;
    if (onlyIfUnset && process.env[key]?.trim()) continue;
    process.env[key] = value;
  }
}

/**
 * 桌面/Tauri 子进程可能未带上 --env-file 或父进程 env，启动时从 mcp/.env 补全。
 */
export function bootstrapTiktokMcpProcess(): void {
  if (!process.env.HOME?.trim()) {
    process.env.HOME = homedir();
  }
  const root = process.env.TIKTOK_MCP_ROOT?.trim();
  if (root) {
    try {
      if (existsSync(root)) process.chdir(root);
    } catch {
      // ignore
    }
  }
}

/** 仅加载共享 mcp/.env（与 shopee-mcp 等共用），不再读 tiktok-mcp/.env */
export function bootstrapTiktokMcpEnv(): void {
  bootstrapTiktokMcpProcess();
  const candidates: string[] = [];
  const mcpRoot = process.env.TIKTOK_MCP_ROOT?.trim();
  if (mcpRoot) {
    candidates.push(join(dirname(mcpRoot), ".env"));
  }
  const distDir = dirname(fileURLToPath(import.meta.url));
  candidates.push(join(distDir, "..", "..", ".env"));
  candidates.push(join(homedir(), ".Claude", "mcp", ".env"));
  candidates.push(join(homedir(), ".binfenhui", "mcp", ".env"));

  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    applyEnvFile(file, true);
  }
}
