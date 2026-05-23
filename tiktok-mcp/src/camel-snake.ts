export function camelToSnake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

export function snakeToCamel(input: string): string {
  return input.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
