import { CapabilityError, type Schema } from "./types.js";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Deliberately small, closed JSON Schema subset used by our compiled descriptors. */
export function validateSchema(schema: Schema, value: unknown, path = "arguments", depth = 0): void {
  const fail = (why: string): never => { throw new CapabilityError("INVALID_ARGUMENTS", `${path}: ${why}`); };
  if (depth > 24) fail("nesting limit exceeded");
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some(option => { try { validateSchema(option as Schema, value, path, depth + 1); return true; } catch { return false; } })) fail("does not match an allowed shape");
    return;
  }
  if (Object.hasOwn(schema, "const") && !equal(schema.const, value)) fail("unexpected constant");
  if (Array.isArray(schema.enum) && !schema.enum.some(item => equal(item, value))) fail("not in the allowed choices");
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.includes(type) && !(type === "number" && types.includes("integer") && Number.isSafeInteger(value))) fail("incorrect type");
  if (typeof value === "number" && (!Number.isFinite(value) || typeof schema.minimum === "number" && value < schema.minimum || typeof schema.maximum === "number" && value > schema.maximum)) fail("outside allowed range");
  if (typeof value === "string" && (value.length > (typeof schema.maxLength === "number" ? schema.maxLength : 2_000_000) || typeof schema.minLength === "number" && value.length < schema.minLength)) fail("invalid length");
  if (Array.isArray(value)) {
    if (value.length > (typeof schema.maxItems === "number" ? schema.maxItems : 1000) || typeof schema.minItems === "number" && value.length < schema.minItems) fail("invalid array length");
    if (schema.items) value.forEach((item, index) => validateSchema(schema.items as Schema, item, `${path}[${index}]`, depth + 1));
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>, properties = schema.properties as Record<string, Schema> | undefined;
    if (Object.keys(record).some(key => ["__proto__", "constructor", "prototype"].includes(key))) fail("unsafe property");
    for (const key of schema.required as string[] ?? []) if (!Object.hasOwn(record, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(record)) {
      if (properties && Object.hasOwn(properties, key)) validateSchema(properties[key]!, item, `${path}.${key}`, depth + 1);
      else if (schema.additionalProperties === false) fail(`unknown property ${key}`);
    }
  }
}

export function assertSupportedSchema(schema: Schema): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Invalid JSON schema object");
  const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minimum", "maximum", "enum", "const", "anyOf", "description", "minLength", "maxLength"]);
  for (const key of Object.keys(schema)) if (!supported.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  if (types.some(type => !["string", "number", "integer", "boolean", "object", "array", "null"].includes(String(type)))) throw new Error("Invalid schema type");
  if (schema.type === "object" && (schema.additionalProperties !== false || !schema.properties)) throw new Error("Closed object schemas are required");
  if (schema.properties && (typeof schema.properties !== "object" || Array.isArray(schema.properties))) throw new Error("Invalid properties object");
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== "string" || !Object.hasOwn(schema.properties as object ?? {}, key)))) throw new Error("Invalid required properties");
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) throw new Error("Invalid enum");
  if (schema.anyOf !== undefined && (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0)) throw new Error("Invalid alternatives");
  for (const child of Object.values(schema.properties as Record<string, Schema> ?? {})) assertSupportedSchema(child);
  if (schema.items) assertSupportedSchema(schema.items as Schema);
  for (const child of schema.anyOf as Schema[] ?? []) assertSupportedSchema(child);
}
