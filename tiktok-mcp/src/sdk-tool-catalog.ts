import catalogJson from "./generated/sdk-tool-catalog.json" with { type: "json" };

export type SdkToolDefinition = {
  toolName: string;
  apiClient: string;
  method: string;
};

export const SDK_TOOL_CATALOG = catalogJson as SdkToolDefinition[];
