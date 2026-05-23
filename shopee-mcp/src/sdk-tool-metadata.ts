import * as z from "zod/v4";

import type { SdkToolDefinition } from "./sdk-tool-catalog.js";
import metadataFile from "./generated/sdk-tool-metadata.json" with { type: "json" };

export type SdkParamFieldMeta = {
  name: string;
  required: boolean;
  type: string;
  description: string;
};

export type SdkToolMeta = {
  manager: string;
  method: string;
  sdkPath: string;
  summary?: string;
  paramsType?: string;
  paramsOptional: boolean;
  fields: SdkParamFieldMeta[];
};

type MetadataFile = {
  version: number;
  tools: Record<string, SdkToolMeta>;
};

export function loadSdkToolMetadata(): MetadataFile {
  return metadataFile as MetadataFile;
}

export function getToolMeta(toolName: string): SdkToolMeta | undefined {
  return loadSdkToolMetadata().tools[toolName];
}

function isEnumLikeType(type: string): boolean {
  const t = type.trim();
  if (t === "string" || t === "number" || t === "boolean") return false;
  if (t.endsWith("[]")) return false;
  if (t.includes("|")) return false;
  if (/^(Array|Record|object|Buffer|Blob)/.test(t)) return false;
  return /^[A-Z]/.test(t);
}

function tsTypeToZod(type: string): z.ZodType {
  const t = type.replace(/\s+/g, " ").trim();
  if (t === "number") return z.coerce.number();
  if (t === "string") return z.coerce.string();
  if (t === "boolean") return z.coerce.boolean();
  if (t === "number | null") return z.union([z.coerce.number(), z.null()]);
  if (t === "string[]" || t === "Array<string>")
    return z.array(z.coerce.string());
  if (t === "number[]" || t === "Array<number>")
    return z.array(z.coerce.number());
  if (t.endsWith("[]")) {
    const inner = t.slice(0, -2).trim();
    if (inner === "string") return z.array(z.coerce.string());
    if (inner === "number") return z.array(z.coerce.number());
    if (isEnumLikeType(inner)) return z.array(z.coerce.string());
    return z.array(z.unknown());
  }
  if (t.includes("|")) {
    const parts = t.split("|").map((p) => p.trim());
    if (parts.every((p) => p === "string" || /^"[^"]+"$/.test(p))) {
      return z.coerce.string();
    }
    if (parts.every((p) => p === "number" || p === "null")) {
      return z.union([z.coerce.number(), z.null()]);
    }
    if (parts.every((p) => p === "boolean")) return z.coerce.boolean();
  }
  if (isEnumLikeType(t)) return z.coerce.string();
  return z.unknown();
}

function describeField(field: SdkParamFieldMeta): string {
  const bits = [field.type];
  if (field.description) bits.push(field.description);
  if (!field.required) bits.push("(optional)");
  return bits.join(" — ");
}

/** 为单个 SDK 工具构建 params 的 Zod schema（有元数据则展开字段，否则 record） */
export function buildParamsZodSchema(
  meta: SdkToolMeta | undefined
): z.ZodType<Record<string, unknown>> {
  if (!meta?.fields?.length) {
    return z
      .record(z.string(), z.unknown())
      .describe(
        meta?.paramsType
          ? `SDK 参数类型 ${meta.paramsType}（元数据未解析到字段，可传 snake_case 键）`
          : "SDK 方法参数对象，无参可省略或 {}"
      );
  }

  const shape: Record<string, z.ZodType> = {};
  for (const field of meta.fields) {
    let schema = tsTypeToZod(field.type).describe(describeField(field));
    if (!field.required) schema = schema.optional();
    shape[field.name] = schema;
  }

  const requiredNames = meta.fields.filter((f) => f.required).map((f) => f.name);
  let obj = z.object(shape).strict();
  if (meta.paramsOptional) {
    return obj
      .optional()
      .describe(
        `SDK params (${meta.paramsType ?? "object"}). Fields: ${meta.fields.map((f) => f.name).join(", ")}`
      ) as z.ZodType<Record<string, unknown>>;
  }
  if (requiredNames.length === 0) {
    return obj.optional().describe(`SDK params (${meta.paramsType})`) as z.ZodType<
      Record<string, unknown>
    >;
  }
  return obj.describe(
    `SDK params (${meta.paramsType}). Required: ${requiredNames.join(", ")}`
  ) as z.ZodType<Record<string, unknown>>;
}

export function formatToolDescription(
  def: SdkToolDefinition,
  meta?: SdkToolMeta
): string {
  const base =
    meta?.summary?.trim() ||
    (def.manager
      ? `Shopee Open API: sdk.${def.manager}.${def.method}`
      : `Shopee Open API: ShopeeSDK.${def.method}`);

  const lines = [base, `SDK: ${meta?.sdkPath ?? def.toolName}`];
  if (meta?.paramsType) lines.push(`Params type: ${meta.paramsType}`);

  if (meta?.fields?.length) {
    lines.push("", "params fields:");
    for (const f of meta.fields) {
      const req = f.required ? "required" : "optional";
      const desc = f.description ? ` — ${f.description}` : "";
      lines.push(`  - ${f.name} (${f.type}, ${req})${desc}`);
    }
  } else {
    lines.push("", "params: object (see shopee_tool_schema for field docs if available)");
  }

  lines.push(
    "",
    "Shop APIs: main_id + shop_id on invoke envelope; business fields in params.",
    "Use exact field names from shopee_tool_schema (some modules use pageNo, others page_no)."
  );
  return lines.join("\n");
}

export function metaToJsonSchemaParams(meta: SdkToolMeta): Record<string, unknown> {
  if (!meta.fields.length) {
    return {
      type: "object",
      additionalProperties: true,
      description: meta.paramsType
        ? `SDK ${meta.paramsType}`
        : "SDK method parameters",
    };
  }

  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const f of meta.fields) {
    const desc = [f.type, f.description].filter(Boolean).join(" — ") || f.name;
    let prop: Record<string, unknown> = { description: desc };
    if (f.type === "number") prop = { ...prop, type: "number" };
    else if (f.type === "boolean") prop = { ...prop, type: "boolean" };
    else if (f.type === "string[]" || f.type.endsWith("[]"))
      prop = {
        ...prop,
        type: "array",
        items: { type: f.type.startsWith("number") ? "number" : "string" },
      };
    else prop = { ...prop, type: "string" };

    properties[f.name] = prop;
    if (f.required) required.push(f.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: true,
  };
}
