/** camelCase → snake_case，用于 MCP 工具名 */
export function camelToSnake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** snake_case → camelCase，用于 video 等 SDK 字段 */
export function snakeToCamel(input: string): string {
  return input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
