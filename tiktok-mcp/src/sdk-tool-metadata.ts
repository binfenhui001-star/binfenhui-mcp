import metadataJson from "./generated/sdk-tool-metadata.json" with { type: "json" };
import * as z from "zod/v4";

import { snakeToCamel } from "./camel-snake.js";

export type PositionalParamMeta = {
  name: string;
  required: boolean;
  type: string;
};

export type RequestBodyFieldMeta = {
  name: string;
  baseName: string;
  type: string;
};

export type RequestBodyMeta = {
  paramName: string;
  type: string;
  fields: RequestBodyFieldMeta[];
};

export type ToolMeta = {
  apiClient: string;
  method: string;
  sdkPath: string;
  summary: string;
  positionalParams: PositionalParamMeta[];
  needsShopAuth: boolean;
  requestBody?: RequestBodyMeta;
};

const METADATA = metadataJson as Record<string, ToolMeta>;

export function getToolMeta(toolName: string): ToolMeta | undefined {
  return METADATA[toolName];
}

export function formatToolDescription(toolName: string, meta: ToolMeta): string {
  const params = meta.positionalParams
    .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`)
    .join(", ");
  return [
    meta.summary || toolName,
    `SDK: ${meta.sdkPath}(${params})`,
    "Call: tiktok_tool_schema → tiktok_sdk_invoke. Shop APIs: shop_id + params.",
    "Use fields[].name (camelCase) or snake_case aliases. See docs/TOOL_CALL_RULES.md.",
  ].join("\n");
}

function zodTypeForParam(param: PositionalParamMeta): z.ZodTypeAny {
  const t = param.type.toLowerCase();
  if (t.includes("number")) {
    return param.required ? z.number() : z.number().optional();
  }
  if (t.includes("boolean")) {
    return param.required ? z.boolean() : z.boolean().optional();
  }
  if (t.includes("[]") || t.includes("array")) {
    return param.required ? z.array(z.unknown()) : z.array(z.unknown()).optional();
  }
  if (t.includes("requestbody") || t.includes("{")) {
    return param.required ? z.record(z.string(), z.unknown()) : z.record(z.string(), z.unknown()).optional();
  }
  return param.required ? z.string() : z.string().optional();
}

export function buildParamsZodSchema(meta: ToolMeta | undefined) {
  if (!meta?.positionalParams.length) {
    return z.record(z.string(), z.unknown()).optional();
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of meta.positionalParams) {
    const snake = param.name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
    shape[snake] = zodTypeForParam(param);
    shape[snakeToCamel(snake)] = zodTypeForParam(param);
  }
  shape.access_token = z.string().optional().describe("店铺 access_token，可覆盖 Redis");
  shape.shop_cipher = z.string().optional();

  return z.object(shape).passthrough();
}

export function metaToJsonSchemaParams(meta: ToolMeta): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of meta.positionalParams) {
    const snake = param.name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
    properties[snake] = {
      description: `${param.name} (${param.type})`,
    };
    if (param.required) required.push(snake);
  }
  properties.access_token = { type: "string", description: "可选，覆盖 Redis token" };
  properties.shop_cipher = { type: "string" };
  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
    additionalProperties: true,
  };
}
