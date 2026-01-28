import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";

export function loadSpecFile<T>(filePath: string, schema: z.ZodType<T>): T {
  const raw = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();

  let parsed: unknown;
  if (ext === ".yaml" || ext === ".yml") {
    parsed = yaml.load(raw);
  } else if (ext === ".json") {
    parsed = JSON.parse(raw);
  } else {
    // try YAML first, then JSON
    try {
      parsed = yaml.load(raw);
    } catch {
      parsed = JSON.parse(raw);
    }
  }

  return schema.parse(parsed);
}
