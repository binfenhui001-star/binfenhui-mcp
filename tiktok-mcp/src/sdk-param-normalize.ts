import * as z from "zod/v4";

import { camelToSnake, snakeToCamel } from "./camel-snake.js";
import type {
  PositionalParamMeta,
  RequestBodyFieldMeta,
  ToolMeta,
} from "./sdk-tool-metadata.js";
import { getToolMeta } from "./sdk-tool-metadata.js";

/** MCP 自动注入，Agent 不必传（传了也可覆盖） */
export const MCP_INJECTED_PARAM_NAMES = new Set([
  "xTtsAccessToken",
  "contentType",
  "shopCipher",
]);

/** 从 params 中剥离的信封 / 鉴权字段（应放在 invoke 顶层 shop_id） */
const ENVELOPE_KEYS = new Set([
  "shop_id",
  "shopId",
  "app_key",
  "appKey",
  "app_label",
  "appLabel",
  "access_token",
  "accessToken",
  "x_tts_access_token",
]);

const HEURISTIC_NUMERIC_KEYS = new Set([
  "page_size",
  "pagesize",
  "pageSize",
  "page_no",
  "pageNo",
  "limit",
  "offset",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function aliasKeysForParam(canonical: string): string[] {
  const snake = camelToSnake(canonical);
  const camel = snakeToCamel(snake);
  const keys = new Set<string>([canonical, snake, camel]);
  if (canonical.endsWith("RequestBody")) {
    const base = canonical.replace(/RequestBody$/, "");
    keys.add(camelToSnake(base) + "_request_body");
    keys.add(snakeToCamel(camelToSnake(base)) + "RequestBody");
    keys.add("body");
    keys.add("request_body");
  }
  return [...keys];
}

export function mergePositionalKeysToCanonical(
  positionalParams: PositionalParamMeta[],
  raw: Record<string, unknown>
): Record<string, unknown> {
  const aliasToCanonical = new Map<string, string>();
  for (const field of positionalParams) {
    for (const alias of aliasKeysForParam(field.name)) {
      aliasToCanonical.set(alias, field.name);
      aliasToCanonical.set(alias.toLowerCase(), field.name);
    }
  }

  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    const canonical = aliasToCanonical.get(key) ?? aliasToCanonical.get(key.toLowerCase());
    if (!canonical) {
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

function isRequestBodyType(type: string, name: string): boolean {
  return type.includes("RequestBody") || name.endsWith("RequestBody");
}

function coerceFieldValue(field: PositionalParamMeta, raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    return field.required && !MCP_INJECTED_PARAM_NAMES.has(field.name) ? raw : undefined;
  }
  if (raw === "" && field.type === "string" && !field.required) {
    return "";
  }
  if (raw === "" && field.type !== "string") {
    return field.required && !MCP_INJECTED_PARAM_NAMES.has(field.name) ? raw : undefined;
  }

  const type = field.type.replace(/\s+/g, " ").trim();

  if (type === "number" || type === "number | null") {
    const n = coerceNumber(raw);
    if (n === undefined && field.required && !MCP_INJECTED_PARAM_NAMES.has(field.name)) {
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
    if (raw === "" && !field.required) return "";
    return typeof raw === "string" ? raw : String(raw);
  }

  if (type === "object" && field.name === "options") {
    if (isPlainObject(raw)) return raw;
    if (raw === undefined) return {};
    throw new Error(`参数 options 应为 object，收到: ${JSON.stringify(raw)}`);
  }

  if (isRequestBodyType(type, field.name)) {
    if (isPlainObject(raw)) return raw;
    // canonicalize 在 hoist 阶段对 meta.requestBody 已处理
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isPlainObject(parsed)) return parsed;
      } catch {
        throw new Error(`参数 ${field.name} 应为 JSON 对象`);
      }
    }
    return raw;
  }

  if (type.includes("[]") || type.includes("Array")) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw.includes(",")) {
      return raw.split(",").map((s) => s.trim());
    }
    return [raw];
  }

  return raw;
}

function zodTypeForNormalize(field: PositionalParamMeta): z.ZodTypeAny {
  const t = field.type.replace(/\s+/g, " ").trim();
  if (t === "number" || t === "number | null") {
    return z.coerce.number();
  }
  if (t === "boolean") {
    return z.coerce.boolean();
  }
  if (t === "object" || field.name === "options") {
    return z.record(z.string(), z.unknown());
  }
  if (isRequestBodyType(t, field.name)) {
    return z.record(z.string(), z.unknown());
  }
  if (t.includes("[]") || t.includes("Array")) {
    return z.array(z.unknown());
  }
  return z.coerce.string();
}

function buildNormalizeZodSchema(meta: ToolMeta): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of meta.positionalParams) {
    let schema = zodTypeForNormalize(field);
    const optional =
      !field.required || MCP_INJECTED_PARAM_NAMES.has(field.name);
    if (optional) {
      schema = schema.optional();
    }
    shape[field.name] = schema;
  }
  return z.object(shape).strict();
}

function coerceRequestBodyField(field: RequestBodyFieldMeta, raw: unknown): unknown {
  const pseudo: PositionalParamMeta = {
    name: field.name,
    required: false,
    type: field.type,
  };
  return coerceFieldValue(pseudo, raw);
}

/** SDK ObjectSerializer 只读取 camelCase 属性名（createTimeGe），再序列化为 create_time_ge */
export function canonicalizeRequestBodyObject(
  rb: NonNullable<ToolMeta["requestBody"]>,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const aliasToName = new Map<string, string>();
  for (const f of rb.fields) {
    for (const alias of [f.name, f.baseName, camelToSnake(f.name)]) {
      aliasToName.set(alias, f.name);
      aliasToName.set(alias.toLowerCase(), f.name);
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === "") continue;
    const canon = aliasToName.get(k) ?? aliasToName.get(k.toLowerCase());
    if (!canon) continue;
    const field = rb.fields.find((f) => f.name === canon);
    if (!field) continue;
    out[canon] = coerceRequestBodyField(field, v);
  }

  validateRequestBodyTimeFields(rb, out);
  return out;
}

function validateRequestBodyTimeFields(
  rb: NonNullable<ToolMeta["requestBody"]>,
  body: Record<string, unknown>
): void {
  const fieldNames = new Set(rb.fields.map((f) => f.name));
  const unixSecKeys = [
    "createTimeGe",
    "createTimeLt",
    "updateTimeGe",
    "updateTimeLt",
  ] as const;

  for (const key of unixSecKeys) {
    if (!fieldNames.has(key)) continue;
    const v = body[key];
    if (typeof v === "number" && v > 1e12) {
      throw new Error(
        `${key} 须为 Unix 秒级时间戳，不要用毫秒（收到 ${v}）。例如秒 = Math.floor(Date.now()/1000)。`
      );
    }
  }

  if (
    fieldNames.has("createTimeGe") &&
    fieldNames.has("createTimeLt") &&
    body.createTimeLt !== undefined &&
    body.createTimeGe === undefined
  ) {
    throw new Error(
      "仅传 createTimeLt 而未传 createTimeGe 时，TikTok API 会从店铺最早时间起查，结果会像「全部历史订单」。请同时传 createTimeGe（可与 createTimeLt 组成时间窗）。"
    );
  }
  if (
    fieldNames.has("updateTimeGe") &&
    fieldNames.has("updateTimeLt") &&
    body.updateTimeLt !== undefined &&
    body.updateTimeGe === undefined
  ) {
    throw new Error(
      "仅传 updateTimeLt 而未传 updateTimeGe 时，API 会从最早更新时间起查。请同时传 updateTimeGe。"
    );
  }
}

/** 将 params 顶层的 body 字段（如 createTimeGe）归入 *RequestBody 对象 */
export function hoistRequestBodyFields(
  meta: ToolMeta,
  merged: Record<string, unknown>
): Record<string, unknown> {
  const rb = meta.requestBody;
  if (!rb?.fields?.length) return merged;

  const bodyFieldAliases = new Map<string, string>();
  for (const f of rb.fields) {
    for (const alias of [f.name, f.baseName, camelToSnake(f.name)]) {
      bodyFieldAliases.set(alias, f.name);
      bodyFieldAliases.set(alias.toLowerCase(), f.name);
    }
  }

  const positionalNames = new Set(
    meta.positionalParams.map((p) => p.name)
  );
  for (const p of meta.positionalParams) {
    for (const alias of aliasKeysForParam(p.name)) {
      positionalNames.add(alias);
    }
  }

  const body: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};

  const existingBody =
    merged[rb.paramName] ??
    merged.body ??
    merged.request_body;
  if (isPlainObject(existingBody)) {
    Object.assign(
      body,
      canonicalizeRequestBodyObject(rb, existingBody as Record<string, unknown>)
    );
  }

  for (const [key, value] of Object.entries(merged)) {
    if (
      key === rb.paramName ||
      key === "body" ||
      key === "request_body"
    ) {
      continue;
    }
    const bodyKey =
      bodyFieldAliases.get(key) ?? bodyFieldAliases.get(key.toLowerCase());
    if (bodyKey) {
      if (body[bodyKey] === undefined) {
        body[bodyKey] = coerceRequestBodyField(
          rb.fields.find((f) => f.name === bodyKey)!,
          value
        );
      }
      continue;
    }
    if (positionalNames.has(key)) {
      rest[key] = value;
    } else {
      rest[key] = value;
    }
  }

  if (Object.keys(body).length > 0) {
    rest[rb.paramName] = canonicalizeRequestBodyObject(rb, body);
  }
  return rest;
}

function applyPositionalDefaults(
  positionalParams: PositionalParamMeta[],
  merged: Record<string, unknown>
): void {
  for (const field of positionalParams) {
    if (field.name === "options" && field.required && merged.options === undefined) {
      merged.options = {};
    }
  }
}

function normalizeHeuristicParams(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    const snake = camelToSnake(key);
    const camel = snakeToCamel(snake);
    if (
      HEURISTIC_NUMERIC_KEYS.has(key) ||
      HEURISTIC_NUMERIC_KEYS.has(snake) ||
      HEURISTIC_NUMERIC_KEYS.has(camel)
    ) {
      const n = coerceNumber(value);
      if (n !== undefined) {
        out[camel] = n;
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}

/**
 * 按工具元数据规范化 params：别名归并、类型强制、剔除未知键、补全 options 等默认值。
 */
export function normalizeSdkParams(
  toolName: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const meta = getToolMeta(toolName);

  if (!meta?.positionalParams?.length) {
    return normalizeHeuristicParams(raw);
  }

  let merged = mergePositionalKeysToCanonical(meta.positionalParams, raw);
  merged = hoistRequestBodyFields(meta, merged);
  merged = mergePositionalKeysToCanonical(meta.positionalParams, merged);
  applyPositionalDefaults(meta.positionalParams, merged);

  const allowed = new Set(meta.positionalParams.map((p) => p.name));
  const unknown = Object.keys(merged).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `未知 params 字段: ${unknown.join(", ")}。请先 tiktok_tool_schema，仅使用 positionalParams[].name 或文档中的 snake_case 别名（如 page_size → pageSize）。`
    );
  }

  const coerced: Record<string, unknown> = {};
  for (const field of meta.positionalParams) {
    if (merged[field.name] === undefined) continue;
    let value = coerceFieldValue(field, merged[field.name]);
    if (
      meta.requestBody &&
      field.name === meta.requestBody.paramName &&
      isPlainObject(value)
    ) {
      value = canonicalizeRequestBodyObject(
        meta.requestBody,
        value as Record<string, unknown>
      );
    }
    coerced[field.name] = value;
  }

  const agentRequired = meta.positionalParams.filter(
    (p) => p.required && !MCP_INJECTED_PARAM_NAMES.has(p.name)
  );
  const missing = agentRequired
    .filter((p) => coerced[p.name] === undefined)
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new Error(
      `缺少必填 params: ${missing.join(", ")}（工具 ${toolName}）。xTtsAccessToken/contentType/shopCipher 由 MCP 注入，无需填写。请先 tiktok_tool_schema。`
    );
  }

  const schema = buildNormalizeZodSchema(meta);
  const parsed = schema.safeParse(coerced);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `params 不符合 ${toolName} 的 schema: ${issues}。请先 tiktok_tool_schema。`
    );
  }

  return parsed.data as Record<string, unknown>;
}

export type InvokeEnvelopeInput = {
  shop_id?: unknown;
  app_key?: string;
  app_label?: string;
  params?: Record<string, unknown>;
};

/** 规范化 tiktok_sdk_invoke / 店铺 API 顶层 shop_id 与 params */
export function normalizeInvokeEnvelope(
  toolName: string,
  input: InvokeEnvelopeInput
): { shop_id?: string | number; app_key?: string; app_label?: string; params: Record<string, unknown> } {
  const rawParams = { ...(input.params ?? {}) };
  const shopId =
    input.shop_id ??
    rawParams.shop_id ??
    rawParams.shopId;
  delete rawParams.shop_id;
  delete rawParams.shopId;

  const params = normalizeSdkParams(toolName, rawParams);

  return {
    ...(shopId !== undefined && shopId !== null && shopId !== ""
      ? { shop_id: shopId as string | number }
      : {}),
    ...(input.app_key ? { app_key: input.app_key } : {}),
    ...(input.app_label ? { app_label: input.app_label } : {}),
    params,
  };
}

/** 供 tiktok_tool_schema：canonical 名与可接受别名 */
export function requestBodyFieldGuide(meta: ToolMeta): RequestBodyFieldMeta[] {
  return meta.requestBody?.fields ?? [];
}

export function paramFieldAliasGuide(meta: ToolMeta): Array<{
  name: string;
  type: string;
  required: boolean;
  agentMustProvide: boolean;
  aliases: string[];
  notes?: string;
}> {
  return meta.positionalParams.map((p) => ({
    name: p.name,
    type: p.type,
    required: p.required,
    agentMustProvide: p.required && !MCP_INJECTED_PARAM_NAMES.has(p.name),
    aliases: aliasKeysForParam(p.name).filter((a) => a !== p.name),
    ...(p.name === "options"
      ? { notes: "可省略，MCP 默认 {}" }
      : MCP_INJECTED_PARAM_NAMES.has(p.name)
        ? { notes: "由 MCP 自动注入，勿手写" }
        : p.name.endsWith("RequestBody")
          ? { notes: "也可用 body / *_request_body" }
          : undefined),
  }));
}
