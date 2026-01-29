import { z } from "zod";
import { loadEnumSets, zEnumFromSet } from "../schema/enums.js";

export type Spec = z.infer<ReturnType<typeof buildSpecSchema>>;

export function buildSpecSchema(schemaPath: string) {
  const enums = loadEnumSets(schemaPath);

  const WorkflowScheduleSchema = z
    .object({
      referenceDateKind: zEnumFromSet(
        "WorkflowScheduleSettingReferenceDateKind",
        enums.sets.WorkflowScheduleSettingReferenceDateKind,
      ).optional(),
      differenceDate: z.number().int().optional(),
      time: z.string().min(1).optional(),
    })
    .strict();

  const WorkflowTaskDesiredSchema = z
    .object({
      key: z.string().min(1).optional(),
      applicationId: z.string().min(1).optional(),
      applicationName: z.string().min(1).optional(),
      actionName: z.string().min(1),
      params: z.unknown().optional(),
    })
    .refine((x) => x.applicationId || x.applicationName, {
      message: "Either applicationId or applicationName is required",
      path: ["applicationId"],
    })
    .strict();

  const WorkflowMemberFilterDesiredSchema = z
    .object({
      criteria: z.unknown(),
    })
    .strict();

  const WorkflowDesiredSchema = z
    .object({
      key: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      name: z.string().min(1),
      triggerKind: zEnumFromSet(
        "WorkflowTriggerKind",
        enums.sets.WorkflowTriggerKind,
      ),
      argumentKind: zEnumFromSet(
        "WorkflowArgumentKind",
        enums.sets.WorkflowArgumentKind,
      ).optional(),
      executionKind: zEnumFromSet(
        "WorkflowExecutionKind",
        enums.sets.WorkflowExecutionKind,
      ).optional(),
      viewerKind: zEnumFromSet(
        "WorkflowViewerKind",
        enums.sets.WorkflowViewerKind,
      ).optional(),
      status: zEnumFromSet(
        "WorkflowStatus",
        enums.sets.WorkflowStatus,
      ).optional(),
      memberFilters: z.array(WorkflowMemberFilterDesiredSchema).optional(),
      schedule: WorkflowScheduleSchema.optional(),
      tasks: z.array(WorkflowTaskDesiredSchema).default([]),
    })
    .strict();

  return z
    .object({
      workflows: z.array(WorkflowDesiredSchema).default([]),
    })
    .strict();
}
