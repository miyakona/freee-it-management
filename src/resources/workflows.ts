import type { GraphQLClient } from "graphql-request";
import { GQL } from "../freee/documents.js";
import { withRetry } from "../freee/graphqlClient.js";

export type RemoteWorkflow = {
  id: string;
  name: string;
  triggerKind: string;
  argumentKind: string | null;
  executionKind: string | null;
  viewerKind: string;
  status: string;
  order: number;
  workflowScheduleSetting: null | {
    referenceDateKind: string;
    differenceDate: number;
    time: string;
  };
  tasks: Array<{
    id: string;
    order: number;
    actionName: string;
    params: unknown;
    application: { id: string; name: string };
  }>;
};

export type WorkflowDesired = {
  name: string;
  triggerKind: string;
  argumentKind?: string;
  executionKind?: string;
  viewerKind?: string;
  status?: string;
  schedule?: {
    referenceDateKind?: string;
    differenceDate?: number;
    time?: string;
  };
  tasks: Array<{ applicationId: string; actionName: string; params?: unknown }>;
};

export type PlanOp =
  | { kind: "create_workflow"; name: string }
  | { kind: "update_workflow"; id: string; name: string; fields: string[] }
  | {
      kind: "update_workflow_status";
      id: string;
      name: string;
      from: string;
      to: string;
    }
  | {
      kind: "update_workflow_viewer_kind";
      id: string;
      name: string;
      from: string;
      to: string;
    }
  | { kind: "update_workflow_schedule"; id: string; name: string }
  | {
      kind: "create_workflow_task";
      workflowId: string;
      workflowName: string;
      key: string;
    }
  | {
      kind: "update_workflow_task";
      workflowTaskId: string;
      workflowName: string;
      key: string;
    }
  | {
      kind: "delete_workflow_task";
      workflowTaskId: string;
      workflowName: string;
      key: string;
    }
  | {
      kind: "reorder_workflow_tasks";
      workflowId: string;
      workflowName: string;
    };

function taskKey(t: { applicationId: string; actionName: string }) {
  return `${t.applicationId}:${t.actionName}`;
}

function remoteTaskKey(t: { application: { id: string }; actionName: string }) {
  return `${t.application.id}:${t.actionName}`;
}

function jsonStable(x: unknown): string {
  return JSON.stringify(x, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (v as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return v;
  });
}

function arrayEq(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function listAllWorkflows(
  client: GraphQLClient,
): Promise<RemoteWorkflow[]> {
  const out: RemoteWorkflow[] = [];
  let after: string | null = null;

  // Pagination via Connection
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await withRetry(() =>
      client.request<{
        team: {
          workflows: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            nodes: RemoteWorkflow[];
          };
        };
      }>(GQL.listWorkflows, { first: 50, after, where: null }),
    );

    out.push(...res.team.workflows.nodes);
    if (!res.team.workflows.pageInfo.hasNextPage) break;
    after = res.team.workflows.pageInfo.endCursor;
  }

  // normalize order
  for (const w of out) {
    w.tasks = [...(w.tasks ?? [])].sort((a, b) => a.order - b.order);
  }
  return out.sort((a, b) => a.order - b.order);
}

export function planWorkflows(
  desired: WorkflowDesired[],
  remote: RemoteWorkflow[],
  opts: { prune: boolean },
): PlanOp[] {
  const ops: PlanOp[] = [];
  const byName = new Map<string, RemoteWorkflow[]>();
  for (const w of remote)
    byName.set(w.name, [...(byName.get(w.name) ?? []), w]);

  for (const d of desired) {
    const candidates = byName.get(d.name) ?? [];
    if (candidates.length === 0) {
      ops.push({ kind: "create_workflow", name: d.name });
      continue;
    }
    if (candidates.length > 1) {
      throw new Error(`Workflow name is not unique on server: ${d.name}`);
    }
    const r = candidates[0];

    const wfFields: string[] = [];
    if (r.name !== d.name) wfFields.push("name");
    if (r.triggerKind !== d.triggerKind) wfFields.push("triggerKind");
    if (
      d.executionKind !== undefined &&
      (r.executionKind ?? null) !== d.executionKind
    )
      wfFields.push("executionKind");

    if (
      d.argumentKind !== undefined &&
      (r.argumentKind ?? null) !== d.argumentKind
    ) {
      // schema: argumentKind is not in UpdateWorkflowInput, so treat as immutable.
      throw new Error(
        `argumentKind is immutable via API (workflow: ${d.name}). remote=${r.argumentKind} desired=${d.argumentKind}`,
      );
    }

    if (wfFields.length)
      ops.push({
        kind: "update_workflow",
        id: r.id,
        name: r.name,
        fields: wfFields,
      });

    if (d.status !== undefined && r.status !== d.status) {
      ops.push({
        kind: "update_workflow_status",
        id: r.id,
        name: r.name,
        from: r.status,
        to: d.status,
      });
    }

    if (d.viewerKind !== undefined && r.viewerKind !== d.viewerKind) {
      ops.push({
        kind: "update_workflow_viewer_kind",
        id: r.id,
        name: r.name,
        from: r.viewerKind,
        to: d.viewerKind,
      });
    }

    if (d.schedule) {
      const rs = r.workflowScheduleSetting;
      const ds = d.schedule;
      const changed =
        (ds.referenceDateKind !== undefined &&
          (rs?.referenceDateKind ?? null) !== ds.referenceDateKind) ||
        (ds.differenceDate !== undefined &&
          (rs?.differenceDate ?? null) !== ds.differenceDate) ||
        (ds.time !== undefined && (rs?.time ?? null) !== ds.time) ||
        rs == null; // desired schedule exists but remote doesn't

      if (changed)
        ops.push({ kind: "update_workflow_schedule", id: r.id, name: r.name });
    }

    // tasks
    const remoteByKey = new Map<string, RemoteWorkflow["tasks"][number]>();
    for (const t of r.tasks ?? []) remoteByKey.set(remoteTaskKey(t), t);
    const desiredByKey = new Map<string, WorkflowDesired["tasks"][number]>();
    for (const t of d.tasks ?? []) desiredByKey.set(taskKey(t), t);

    for (const [k, dt] of desiredByKey) {
      const rt = remoteByKey.get(k);
      if (!rt) {
        ops.push({
          kind: "create_workflow_task",
          workflowId: r.id,
          workflowName: r.name,
          key: k,
        });
      } else {
        const rp = jsonStable(rt.params ?? null);
        const dp = jsonStable(dt.params ?? null);
        if (rp !== dp) {
          ops.push({
            kind: "update_workflow_task",
            workflowTaskId: rt.id,
            workflowName: r.name,
            key: k,
          });
        }
      }
    }

    if (opts.prune) {
      for (const [k, rt] of remoteByKey) {
        if (!desiredByKey.has(k)) {
          ops.push({
            kind: "delete_workflow_task",
            workflowTaskId: rt.id,
            workflowName: r.name,
            key: k,
          });
        }
      }
    }

    // reorder if all desired tasks exist remotely (or will after create); keep as a separate op for apply
    if ((d.tasks ?? []).length >= 2) {
      const desiredOrder = (d.tasks ?? []).map((t) => taskKey(t));
      const currentOrder = (r.tasks ?? []).map((t) => remoteTaskKey(t));
      if (!arrayEq(desiredOrder, currentOrder)) {
        ops.push({
          kind: "reorder_workflow_tasks",
          workflowId: r.id,
          workflowName: r.name,
        });
      }
    }
  }

  return ops;
}

export async function applyWorkflows(
  client: GraphQLClient,
  desired: WorkflowDesired[],
  opts: { prune: boolean },
) {
  // fetch fresh state
  let remote = await listAllWorkflows(client);
  const byName = new Map(remote.map((w) => [w.name, w] as const));

  for (const d of desired) {
    let w = byName.get(d.name);
    if (!w) {
      const created = await withRetry(() =>
        client.request<{
          createWorkflow: {
            workflowEdge: {
              node: {
                id: string;
                name: string;
                triggerKind: string;
                argumentKind: string | null;
              };
            };
          };
        }>(GQL.createWorkflow, {
          input: {
            name: d.name,
            triggerKind: d.triggerKind,
            argumentKind: d.argumentKind,
          },
        }),
      );
      const id = created.createWorkflow.workflowEdge.node.id;
      // refresh single workflow by refetching all (simple and robust)
      remote = await listAllWorkflows(client);
      byName.clear();
      for (const rw of remote) byName.set(rw.name, rw);
      w = byName.get(d.name);
      if (!w)
        throw new Error(
          `Created workflow but cannot find it by name. id=${id} name=${d.name}`,
        );
    }

    // update workflow mutable fields
    const wfFields: Record<string, unknown> = { workflowId: w.id };
    let needsUpdateWorkflow = false;
    if (w.triggerKind !== d.triggerKind) {
      wfFields.triggerKind = d.triggerKind;
      needsUpdateWorkflow = true;
    }
    if (
      (w.executionKind ?? null) !== (d.executionKind ?? null) &&
      d.executionKind !== undefined
    ) {
      wfFields.executionKind = d.executionKind;
      needsUpdateWorkflow = true;
    }
    // name changes are not supported in our match-by-name model; keep it simple
    if (needsUpdateWorkflow) {
      await withRetry(() =>
        client.request(GQL.updateWorkflow, { input: wfFields }),
      );
    }

    if (d.status !== undefined && w.status !== d.status) {
      await withRetry(() =>
        client.request(GQL.updateWorkflowStatus, {
          input: { workflowId: w!.id, status: d.status },
        }),
      );
    }

    if (d.viewerKind !== undefined && w.viewerKind !== d.viewerKind) {
      await withRetry(() =>
        client.request(GQL.updateWorkflowViewerKind, {
          input: { workflowId: w!.id, viewerKind: d.viewerKind },
        }),
      );
    }

    if (d.schedule) {
      await withRetry(() =>
        client.request(GQL.updateWorkflowSchedule, {
          input: {
            workflowId: w!.id,
            name: d.name,
            triggerKind: d.triggerKind,
            referenceDateKind: d.schedule?.referenceDateKind,
            differenceDate: d.schedule?.differenceDate,
            time: d.schedule?.time,
          },
        }),
      );
    }

    // refresh workflow to get latest tasks
    remote = await listAllWorkflows(client);
    byName.clear();
    for (const rw of remote) byName.set(rw.name, rw);
    w = byName.get(d.name);
    if (!w) throw new Error(`Workflow disappeared: ${d.name}`);

    // tasks
    const remoteByKey = new Map<string, RemoteWorkflow["tasks"][number]>();
    for (const t of w.tasks ?? []) remoteByKey.set(remoteTaskKey(t), t);
    const desiredByKey = new Map<string, WorkflowDesired["tasks"][number]>();
    for (const t of d.tasks ?? []) desiredByKey.set(taskKey(t), t);

    // create/update
    for (const [k, dt] of desiredByKey) {
      const rt = remoteByKey.get(k);
      if (!rt) {
        await withRetry(() =>
          client.request(GQL.createWorkflowTask, {
            input: {
              workflowId: w!.id,
              applicationId: dt.applicationId,
              actionName: dt.actionName,
              params: dt.params ?? null,
            },
          }),
        );
      } else {
        const rp = jsonStable(rt.params ?? null);
        const dp = jsonStable(dt.params ?? null);
        if (rp !== dp) {
          await withRetry(() =>
            client.request(GQL.updateWorkflowTask, {
              input: { workflowTaskId: rt.id, params: dt.params ?? null },
            }),
          );
        }
      }
    }

    // prune
    if (opts.prune) {
      for (const [k, rt] of remoteByKey) {
        if (!desiredByKey.has(k)) {
          await withRetry(() =>
            client.request(GQL.deleteWorkflowTask, {
              input: { workflowTaskId: rt.id },
            }),
          );
        }
      }
    }

    // reorder (best-effort)
    if ((d.tasks ?? []).length >= 2) {
      remote = await listAllWorkflows(client);
      byName.clear();
      for (const rw of remote) byName.set(rw.name, rw);
      w = byName.get(d.name);
      if (!w) throw new Error(`Workflow disappeared: ${d.name}`);

      const desiredOrder = (d.tasks ?? []).map((t) => taskKey(t));
      const current = [...(w.tasks ?? [])].sort((a, b) => a.order - b.order);
      const currentOrder = current.map((t) => remoteTaskKey(t));
      if (arrayEq(desiredOrder, currentOrder)) continue;

      const byKey = new Map(current.map((t) => [remoteTaskKey(t), t] as const));
      const ids: string[] = [];
      for (const k of desiredOrder) {
        const t = byKey.get(k);
        if (!t) continue; // best-effort
        ids.push(t.id);
      }

      // bubble each to correct position using MOVE_UP
      let orderIds = current.map((t) => t.id);
      for (let i = 0; i < ids.length; i++) {
        const targetId = ids[i];
        let j = orderIds.indexOf(targetId);
        while (j > i) {
          await withRetry(() =>
            client.request(GQL.reorderWorkflowTask, {
              input: { workflowTaskId: targetId, action: "MOVE_UP" },
            }),
          );
          // update local order approximation
          const tmp = orderIds[j - 1];
          orderIds[j - 1] = orderIds[j];
          orderIds[j] = tmp;
          j -= 1;
        }
      }
    }
  }
}
