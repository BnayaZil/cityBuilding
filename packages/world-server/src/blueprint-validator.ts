import cityBlueprintSchema from "../../shared/src/generated/city-blueprint.schema.json" with { type: "json" };

type JsonSchema = Record<string, unknown>;

export interface ValidationIssue {
  path: string;
  message: string;
}

const rootSchema = cityBlueprintSchema as JsonSchema;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return schema;
  }
  const parts = ref.slice(2).split("/");
  let current: unknown = root;
  for (const part of parts) {
    if (!isObject(current)) {
      return schema;
    }
    current = current[part];
  }
  return isObject(current) ? current : schema;
}

function validatePrimitive(value: unknown, expectedType: string): boolean {
  if (expectedType === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (expectedType === "number") {
    return typeof value === "number";
  }
  if (expectedType === "null") {
    return value === null;
  }
  return typeof value === expectedType;
}

function validateNode(value: unknown, schemaInput: JsonSchema, root: JsonSchema, path: string, issues: ValidationIssue[]) {
  const schema = resolveRef(schemaInput, root);

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const ok = schema.oneOf.some((option) => {
      const innerIssues: ValidationIssue[] = [];
      validateNode(value, option as JsonSchema, root, path, innerIssues);
      return innerIssues.length === 0;
    });
    if (!ok) {
      issues.push({ path, message: "does not match any allowed variant" });
    }
    return;
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const ok = schema.anyOf.some((option) => {
      const innerIssues: ValidationIssue[] = [];
      validateNode(value, option as JsonSchema, root, path, innerIssues);
      return innerIssues.length === 0;
    });
    if (!ok) {
      issues.push({ path, message: "does not match any allowed branch" });
    }
    return;
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      issues.push({ path, message: "value is not in enum" });
    }
    return;
  }

  const schemaType = schema.type;
  if (typeof schemaType === "string") {
    if (schemaType === "object") {
      if (!isObject(value)) {
        issues.push({ path, message: "expected object" });
        return;
      }
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      for (const key of required) {
        if (!(key in value)) {
          issues.push({ path: `${path}/${key}`, message: "is required" });
        }
      }
      const properties = isObject(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value) {
          validateNode(value[key], propertySchema, root, `${path}/${key}`, issues);
        }
      }
      if (isObject(schema.additionalProperties)) {
        for (const [key, childValue] of Object.entries(value)) {
          if (!properties[key]) {
            validateNode(
              childValue,
              schema.additionalProperties as JsonSchema,
              root,
              `${path}/${key}`,
              issues,
            );
          }
        }
      }
      return;
    }

    if (schemaType === "array") {
      if (!Array.isArray(value)) {
        issues.push({ path, message: "expected array" });
        return;
      }
      if (isObject(schema.items)) {
        value.forEach((entry, index) => {
          validateNode(entry, schema.items as JsonSchema, root, `${path}/${index}`, issues);
        });
      }
      return;
    }

    if (!validatePrimitive(value, schemaType)) {
      issues.push({ path, message: `expected ${schemaType}` });
      return;
    }
  }
}

export function validateBlueprintPayload(payload: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateNode(payload, rootSchema, rootSchema, "", issues);
  return issues;
}
