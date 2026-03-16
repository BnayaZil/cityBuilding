import { compile } from "json-schema-to-typescript";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const generatedDir = path.resolve("packages/shared/src/generated");
const blueprintSchemaRaw = await readFile(path.join(generatedDir, "city-blueprint.schema.json"), "utf8");
const summarySchemaRaw = await readFile(path.join(generatedDir, "city-summary.schema.json"), "utf8");

const blueprintSchema = JSON.parse(blueprintSchemaRaw);
const summarySchema = JSON.parse(summarySchemaRaw);

const blueprintTs = await compile(blueprintSchema, "CityBlueprint", {
  bannerComment: "/* eslint-disable */\n// Generated file. Do not edit directly.\n",
  style: { singleQuote: true },
});
const summaryTs = await compile(summarySchema, "CitySummary", {
  bannerComment: "",
  style: { singleQuote: true },
});

const output = `${blueprintTs}\n${summaryTs}\n`;
await writeFile(path.resolve("packages/shared/src/types.generated.ts"), output, "utf8");
