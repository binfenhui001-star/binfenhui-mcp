import { ShopeeSDK } from "@congminh1254/shopee-sdk";

import { camelToSnake } from "./camel-snake.js";

export type SdkToolDefinition = {
  /** MCP 工具名，如 shopee_order_get_order_list */
  toolName: string;
  /** SDK 管理器属性名，空字符串表示 ShopeeSDK 自身方法 */
  manager: string;
  method: string;
};

const SKIP_SDK_METHODS = new Set([
  "constructor",
  "getConfig",
  "setRegion",
  "setBaseUrl",
  "setFetchAgent",
]);

const SKIP_MANAGER_KEYS = new Set(["tokenStorage", "config"]);

function isApiManager(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return typeof name === "string" && name.endsWith("Manager");
}

/**
 * 从 ShopeeSDK 实例反射全部 Manager 方法与 SDK 级方法（启动时调用一次）。
 */
export function discoverSdkToolDefinitions(): SdkToolDefinition[] {
  const sdk = new ShopeeSDK({ partner_id: 0, partner_key: "__catalog__" });
  const tools: SdkToolDefinition[] = [];
  const seen = new Set<string>();

  const push = (def: SdkToolDefinition) => {
    if (seen.has(def.toolName)) return;
    seen.add(def.toolName);
    tools.push(def);
  };

  const sdkProto = Object.getPrototypeOf(sdk) as object;
  for (const method of Object.getOwnPropertyNames(sdkProto)) {
    if (SKIP_SDK_METHODS.has(method)) continue;
    const fn = (sdk as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") continue;
    push({
      manager: "",
      method,
      toolName: `shopee_sdk_${camelToSnake(method)}`,
    });
  }

  for (const [managerKey, manager] of Object.entries(sdk)) {
    if (SKIP_MANAGER_KEYS.has(managerKey) || !isApiManager(manager)) continue;
    const proto = Object.getPrototypeOf(manager) as object;
    for (const method of Object.getOwnPropertyNames(proto)) {
      if (method === "constructor") continue;
      const fn = (proto as Record<string, unknown>)[method];
      if (typeof fn !== "function") continue;
      push({
        manager: managerKey,
        method,
        toolName: `shopee_${camelToSnake(managerKey)}_${camelToSnake(method)}`,
      });
    }
  }

  tools.sort((a, b) => a.toolName.localeCompare(b.toolName));
  return tools;
}

/** 启动时缓存，避免重复反射 */
export const SDK_TOOL_CATALOG: SdkToolDefinition[] = discoverSdkToolDefinitions();
