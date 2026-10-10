export const ATTRIBUTE_KEYS = ["angle", "hook", "format", "length_s", "version", "avatar"] as const;

export function attributeValue(key: string, value: string): string | number {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) throw new Error(`Invalid attribute key "${key}"`);
  if (key === "length_s") {
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`length_s must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`length_s must be a positive integer`);
    return parsed;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`Attribute ${key} must be a lowercase slug`);
  return value;
}
