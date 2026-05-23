import type { SdkToolDefinition } from "./sdk-tool-catalog.js";
import { canonicalizeRequestBodyObject } from "./sdk-param-normalize.js";
import type { ToolMeta } from "./sdk-tool-metadata.js";
import { getToolMeta } from "./sdk-tool-metadata.js";
import { snakeToCamel } from "./camel-snake.js";
import type { TiktokApiClient } from "./tiktok-sdk-client.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRequestBody(
  meta: ToolMeta,
  params: Record<string, unknown>
): unknown {
  const rb = meta.requestBody;
  if (!rb) {
    return (
      pickParam(params, "body") ??
      pickParam(params, "request_body")
    );
  }

  let body =
    pickParam(params, rb.paramName) ??
    pickParam(params, rb.paramName.replace(/RequestBody$/, "_request_body")) ??
    pickParam(params, "body") ??
    pickParam(params, "request_body");

  if (!isPlainObject(body)) {
    const assembled: Record<string, unknown> = {};
    for (const f of rb.fields) {
      const v = pickParam(params, f.name);
      if (v !== undefined) assembled[f.name] = v;
    }
    if (Object.keys(assembled).length > 0) {
      body = assembled;
    }
  }

  if (isPlainObject(body)) {
    return canonicalizeRequestBodyObject(rb, body);
  }
  return body;
}

function pickParam(
  params: Record<string, unknown>,
  name: string
): unknown {
  if (name in params) return params[name];
  const snake = name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
  if (snake in params) return params[snake];
  const camel = snakeToCamel(snake);
  if (camel in params) return params[camel];
  return undefined;
}

function buildPositionalArgs(
  meta: ToolMeta,
  params: Record<string, unknown>,
  accessToken: string
): unknown[] {
  const args: unknown[] = [];
  for (const field of meta.positionalParams) {
    const name = field.name;
    if (name === "xTtsAccessToken") {
      args.push(
        String(
          pickParam(params, "access_token") ??
            pickParam(params, "x_tts_access_token") ??
            accessToken
        )
      );
      continue;
    }
    if (name === "contentType") {
      args.push(
        String(
          pickParam(params, "content_type") ??
            pickParam(params, "contentType") ??
            "application/json"
        )
      );
      continue;
    }
    if (field.type.includes("RequestBody") || name.endsWith("RequestBody")) {
      args.push(resolveRequestBody(meta, params));
      continue;
    }
    if (name === "options") {
      const opt = pickParam(params, "options");
      args.push(isPlainObject(opt) ? opt : { headers: {} });
      continue;
    }
    const value = pickParam(params, name);
    if (value === undefined && field.required) {
      throw new Error(`缺少必填参数: ${name}`);
    }
    args.push(value);
  }
  return args;
}

export function serializeApiResult(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { _type: "Buffer", base64: value.toString("base64") };
  }
  if (Array.isArray(value)) {
    return value.map(serializeApiResult);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeApiResult(v);
    }
    return out;
  }
  return value;
}

export async function invokeSdkTool(
  client: TiktokApiClient,
  def: SdkToolDefinition,
  params: Record<string, unknown>,
  accessToken: string
): Promise<unknown> {
  const meta = getToolMeta(def.toolName);
  if (!meta) {
    throw new Error(`工具元数据缺失: ${def.toolName}，请运行 npm run generate:catalog`);
  }

  const apiGroup = client.api[def.apiClient];
  if (!apiGroup) {
    throw new Error(`API 客户端不存在: ${def.apiClient}`);
  }
  const fn = apiGroup[def.method];
  if (typeof fn !== "function") {
    throw new Error(`API 方法不存在: ${def.apiClient}.${def.method}`);
  }

  const args = buildPositionalArgs(meta, params, accessToken);
  const result = await fn.apply(apiGroup, args);
  if (result && typeof result === "object" && "body" in result) {
    return (result as { body: unknown }).body;
  }
  return result;
}
