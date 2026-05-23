import * as z from "zod/v4";

import { camelToSnake, snakeToCamel } from "./camel-snake.js";
import type { SdkParamFieldMeta, SdkToolMeta } from "./sdk-tool-metadata.js";
import { buildParamsZodSchema, getToolMeta } from "./sdk-tool-metadata.js";

/** 无元数据工具：常见 Open API 字段启发式校正 */
const HEURISTIC_NUMERIC_KEYS = new Set([
  "main_id",
  "shop_id",
  "merchant_id",
  "partner_id",
  "page_no",
  "page_size",
  "offset",
  "limit",
  "item_id",
  "model_id",
  "campaign_id",
  "time_from",
  "time_to",
  "update_time_from",
  "update_time_to",
  "start_time",
  "end_time",
  "pageno",
  "pagesize",
]);

const HEURISTIC_STRING_KEYS = new Set([
  "code",
  "cursor",
  "order_sn",
  "redirect_uri",
  "time_range_field",
  "order_status",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function aliasKeysForField(canonical: string): string[] {
  const snake = camelToSnake(canonical);
  const camel = snakeToCamel(snake);
  const keys = new Set<string>([canonical, snake, camel]);
  return [...keys];
}

/** 将入参键名归并到元数据中的 canonical 字段名（支持 page_no ↔ pageNo） */
export function mergeParamKeysToCanonical(
  fields: SdkParamFieldMeta[],
  raw: Record<string, unknown>
): Record<string, unknown> {
  const aliasToCanonical = new Map<string, string>();
  for (const field of fields) {
    for (const alias of aliasKeysForField(field.name)) {
      aliasToCanonical.set(alias, field.name);
      aliasToCanonical.set(alias.toLowerCase(), field.name);
    }
  }

  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const canonical = aliasToCanonical.get(key) ?? aliasToCanonical.get(key.toLowerCase());
    if (!canonical) {
      // 保留未知键，后续 strict parse 会剔除
      merged[key] = value;
      continue;
    }
    if (merged[canonical] === undefined) {
      merged[canonical] = value;
    }
  }
  return merged;
}

function coerceNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return undefined;
}

function isEnumLikeType(type: string): boolean {
  const t = type.trim();
  if (t === "string" || t === "number" || t === "boolean") return false;
  if (t.endsWith("[]")) return false;
  if (t.includes("|")) return false;
  if (/^(Array|Record|object|Buffer|Blob)/.test(t)) return false;
  return /^[A-Z]/.test(t);
}

function coerceArrayElement(innerType: string, value: unknown): unknown {
  const inner = innerType.replace(/\[\]$/, "").trim();
  if (inner === "number") return coerceNumber(value);
  return value === undefined || value === null ? undefined : String(value);
}

function coerceFieldValue(field: SdkParamFieldMeta, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") {
    return field.required ? raw : undefined;
  }

  const type = field.type.replace(/\s+/g, " ").trim();

  if (type === "number" || type === "number | null") {
    const n = coerceNumber(raw);
    if (n === undefined && field.required) {
      throw new Error(`参数 ${field.name} 应为 number，收到: ${JSON.stringify(raw)}`);
    }
    return n;
  }

  if (type === "boolean") {
    const b = coerceBoolean(raw);
    if (b === undefined && field.required) {
      throw new Error(`参数 ${field.name} 应为 boolean，收到: ${JSON.stringify(raw)}`);
    }
    return b;
  }

  if (type === "string") {
    return typeof raw === "string" ? raw : String(raw);
  }

  if (type.endsWith("[]")) {
    const inner = type.slice(0, -2);
    let items: unknown[];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (typeof raw === "string" && raw.includes(",")) {
      items = raw.split(",").map((s) => s.trim());
    } else {
      items = [raw];
    }
    return items
      .map((item) => coerceArrayElement(inner, item))
      .filter((item) => item !== undefined);
  }

  if (isEnumLikeType(type)) {
    return typeof raw === "string" ? raw : String(raw);
  }

  return raw;
}

function normalizeHeuristicParams(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const snake = camelToSnake(key);
    const camel = snakeToCamel(snake);
    const candidates = [key, snake, camel];
    let placed = false;
    for (const k of candidates) {
      const lower = k.toLowerCase();
      if (HEURISTIC_NUMERIC_KEYS.has(lower) || HEURISTIC_NUMERIC_KEYS.has(k)) {
        const n = coerceNumber(value);
        if (n !== undefined) {
          out[k] = n;
          placed = true;
          break;
        }
      }
    }
    if (placed) continue;
    for (const k of candidates) {
      if (HEURISTIC_STRING_KEYS.has(k) || HEURISTIC_STRING_KEYS.has(camelToSnake(k))) {
        out[k] = typeof value === "string" ? value : String(value);
        placed = true;
        break;
      }
    }
    if (!placed) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 按工具元数据规范化 params（类型强制、别名、剔除多余键）。
 * 无元数据时使用启发式规则。
 */
export function normalizeSdkParams(
  toolName: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const meta = getToolMeta(toolName);

  if (!meta?.fields?.length) {
    return normalizeHeuristicParams(mergeParamKeysToCanonical([], raw));
  }

  const merged = mergeParamKeysToCanonical(meta.fields, raw);

  const allowed = new Set(meta.fields.map((f) => f.name));
  const unknown = Object.keys(merged).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `未知 params 字段: ${unknown.join(", ")}。请仅使用 shopee_tool_schema 返回的 fields[].name（含 page_no/pageNo 等等价别名）。`
    );
  }

  const coerced: Record<string, unknown> = {};
  for (const field of meta.fields) {
    if (merged[field.name] === undefined) continue;
    coerced[field.name] = coerceFieldValue(field, merged[field.name]);
  }

  const schema = buildParamsZodSchema(meta);
  const parsed = schema.safeParse(coerced);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    const required = meta.fields.filter((f) => f.required).map((f) => f.name);
    throw new Error(
      `params 不符合 ${toolName} 的 schema: ${issues}。必填: ${required.join(", ") || "无"}。请先 shopee_tool_schema。`
    );
  }

  const value = parsed.data;
  if (value === undefined) return {};
  return value as Record<string, unknown>;
}

export function positiveIntOrUndef(value: unknown): number | undefined {
  return coerceNumber(value) !== undefined
    ? Math.floor(coerceNumber(value)!)
    : undefined;
}

export type InvokeEnvelopeInput = {
  main_id?: unknown;
  shop_id?: unknown;
  params?: Record<string, unknown>;
};

/** 规范化 shopee_sdk_invoke / 店铺 API 顶层 main_id、shop_id */
export function normalizeInvokeEnvelope(
  toolName: string,
  input: InvokeEnvelopeInput
): { main_id?: number; shop_id?: number; params: Record<string, unknown> } {
  const rawParams = { ...(input.params ?? {}) };
  const mainId =
    positiveIntOrUndef(input.main_id) ??
    positiveIntOrUndef(rawParams.main_id) ??
    positiveIntOrUndef(rawParams.mainId);
  const shopId =
    positiveIntOrUndef(input.shop_id) ??
    positiveIntOrUndef(rawParams.shop_id) ??
    positiveIntOrUndef(rawParams.shopId);

  delete rawParams.main_id;
  delete rawParams.mainId;
  delete rawParams.shop_id;
  delete rawParams.shopId;
  delete rawParams.mainId;

  const params = normalizeSdkParams(toolName, rawParams);

  return {
    ...(mainId ? { main_id: mainId } : {}),
    ...(shopId ? { shop_id: shopId } : {}),
    params,
  };
}

/** 供 shopee_tool_schema 返回：字段 canonical 名与可接受的别名 */
export function paramFieldAliasGuide(meta: SdkToolMeta): Array<{
  name: string;
  type: string;
  required: boolean;
  aliases: string[];
}> {
  return meta.fields.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required,
    aliases: aliasKeysForField(f.name).filter((a) => a !== f.name),
  }));
}
