import fs from "node:fs";
import { z } from "zod";

type Introspection = {
  data: {
    __schema: {
      types: Array<{
        kind: string;
        name: string | null;
        enumValues?: Array<{ name: string }>;
      }>;
    };
  };
};

function readIntrospection(schemaPath: string): Introspection {
  const raw = fs.readFileSync(schemaPath, "utf8");
  return JSON.parse(raw) as Introspection;
}

function enumValues(schema: Introspection, enumName: string): string[] {
  const t = schema.data.__schema.types.find((x) => x.name === enumName);
  if (!t || t.kind !== "ENUM") return [];
  return (t.enumValues ?? []).map((v) => v.name);
}

export function loadEnumSets(schemaPath: string) {
  const schema = readIntrospection(schemaPath);

  const enums = {
    WorkflowTriggerKind: enumValues(schema, "WorkflowTriggerKind"),
    WorkflowArgumentKind: enumValues(schema, "WorkflowArgumentKind"),
    WorkflowExecutionKind: enumValues(schema, "WorkflowExecutionKind"),
    WorkflowViewerKind: enumValues(schema, "WorkflowViewerKind"),
    WorkflowStatus: enumValues(schema, "WorkflowStatus"),
    WorkflowScheduleSettingReferenceDateKind: enumValues(
      schema,
      "WorkflowScheduleSettingReferenceDateKind",
    ),
  } as const;

  return {
    ...enums,
    sets: {
      WorkflowTriggerKind: new Set(enums.WorkflowTriggerKind),
      WorkflowArgumentKind: new Set(enums.WorkflowArgumentKind),
      WorkflowExecutionKind: new Set(enums.WorkflowExecutionKind),
      WorkflowViewerKind: new Set(enums.WorkflowViewerKind),
      WorkflowStatus: new Set(enums.WorkflowStatus),
      WorkflowScheduleSettingReferenceDateKind: new Set(
        enums.WorkflowScheduleSettingReferenceDateKind,
      ),
    },
  };
}

export function zEnumFromSet<T extends string>(name: string, values: Set<T>) {
  return z.string().refine((v): v is T => values.has(v as T), {
    message: `${name} must be one of: ${Array.from(values).join(", ")}`,
  });
}
