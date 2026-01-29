import type { GraphQLClient } from "graphql-request";
import { GQL } from "../freee/documents.js";
import { withRetry } from "../freee/graphqlClient.js";
import { type CatalogIndex, loadCatalog } from "./catalog.js";
import type { WorkflowDesired } from "./workflows.js";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function looksLikeUuid(x: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    x,
  );
}

function resolveDepartmentDatabaseId(
  idx: CatalogIndex,
  nameOrFullName: string,
) {
  const k = norm(nameOrFullName);
  return (
    idx.departmentDatabaseIdByFullName.get(k) ??
    idx.departmentDatabaseIdByUniqueName.get(k) ??
    null
  );
}

function suggestDepartments(
  departments: Array<{ fullName: string; name: string }>,
  q: string,
): string[] {
  const nq = norm(q);
  const hits: string[] = [];
  for (const d of departments) {
    const full = norm(d.fullName);
    const name = norm(d.name);
    if (
      full.includes(nq) ||
      name.includes(nq) ||
      nq.includes(full) ||
      nq.includes(name)
    ) {
      hits.push(d.fullName);
    }
  }
  return [...new Set(hits)].slice(0, 10);
}

function resolveApplicationId(idx: CatalogIndex, applicationName: string) {
  const ids = idx.applicationIdsByName.get(norm(applicationName)) ?? [];
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  throw new Error(
    `Application name is not unique: ${applicationName}. Please set applicationId explicitly. candidates=[${ids.join(
      ", ",
    )}]`,
  );
}

function resolveApplicationName(idx: CatalogIndex, applicationId: string) {
  return idx.applicationNameById.get(applicationId) ?? null;
}

function mapJson(
  x: unknown,
  fn: (o: Record<string, unknown>) => void,
): unknown {
  if (!x || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map((v) => mapJson(v, fn));
  const o = x as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) next[k] = mapJson(v, fn);
  fn(next);
  return next;
}

async function mapJsonAsync(
  x: unknown,
  fn: (o: Record<string, unknown>) => Promise<void>,
): Promise<unknown> {
  if (!x || typeof x !== "object") return x;
  if (Array.isArray(x)) return Promise.all(x.map((v) => mapJsonAsync(v, fn)));
  const o = x as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) next[k] = await mapJsonAsync(v, fn);
  await fn(next);
  return next;
}

function resolveMemberFilterCriteria(
  idx: CatalogIndex,
  catalogDepartments: Array<{ fullName: string; name: string }>,
  criteria: unknown,
): unknown {
  return mapJson(criteria, (o) => {
    if (typeof o.attribute_name !== "string") return;
    if (o.attribute_name !== "department") return;

    // preferred: value_name -> value(databaseId)
    if (typeof o.value_name === "string") {
      const id = resolveDepartmentDatabaseId(idx, o.value_name);
      if (!id)
        throw new Error(
          `Cannot resolve department value_name=${o.value_name} to databaseId. candidates=${suggestDepartments(
            catalogDepartments,
            o.value_name,
          ).join(" | ")}`,
        );
      o.value = id;
      delete o.value_name;
      return;
    }

    // convenience: value can be a department name/fullName
    if (typeof o.value === "string" && !looksLikeUuid(o.value)) {
      const id = resolveDepartmentDatabaseId(idx, o.value);
      if (!id)
        throw new Error(
          `Cannot resolve department value=${o.value} to databaseId. candidates=${suggestDepartments(
            catalogDepartments,
            o.value,
          ).join(" | ")}`,
        );
      o.value = id;
    }
  });
}

async function lookupApplicationGroupDatabaseId(opts: {
  client: GraphQLClient;
  applicationId: string;
  keyword: string;
  cache: Map<string, string>;
}): Promise<string> {
  const cacheKey = `${opts.applicationId}::${norm(opts.keyword)}`;
  const cached = opts.cache.get(cacheKey);
  if (cached) return cached;

  const res = await withRetry(() =>
    opts.client.request<{
      node: null | {
        id: string;
        name: string;
        groups: { nodes: Array<{ databaseId: string; name: string }> };
      };
    }>(GQL.lookupApplicationGroups, {
      applicationId: opts.applicationId,
      keyword: opts.keyword,
    }),
  );

  const app = res.node;
  if (!app) throw new Error(`Application not found: ${opts.applicationId}`);
  const nodes = app.groups.nodes ?? [];

  const exact = nodes.find((g) => norm(g.name) === norm(opts.keyword));
  const chosen =
    exact ??
    (nodes.length === 1 ? nodes[0] : null) ??
    (() => {
      throw new Error(
        `Ambiguous application group name=${opts.keyword} for application=${app.name} hits=[${nodes
          .map((g) => g.name)
          .join(", ")}]`,
      );
    })();

  opts.cache.set(cacheKey, chosen.databaseId);
  return chosen.databaseId;
}

async function resolveTaskParams(
  idx: CatalogIndex,
  client: GraphQLClient,
  params: unknown,
  ctx: { applicationId: string | null; applicationName: string | null },
  appGroupCache: Map<string, string>,
): Promise<unknown> {
  return mapJsonAsync(params, async (o) => {
    // support either:
    // - application_group_name -> application_group_id
    // - application_group_id: "<name>" (if it's not UUID)
    const appId = ctx.applicationId;
    const nameKey = "application_group_name";
    const idKey = "application_group_id";

    if (typeof o[nameKey] === "string") {
      if (!appId)
        throw new Error(
          `application_group_name=${o[nameKey]} requires applicationId (or applicationName resolved to id)`,
        );
      o[idKey] = await lookupApplicationGroupDatabaseId({
        client,
        applicationId: appId,
        keyword: o[nameKey] as string,
        cache: appGroupCache,
      });
      delete o[nameKey];
    }

    if (typeof o[idKey] === "string" && !looksLikeUuid(o[idKey] as string)) {
      if (!appId)
        throw new Error(
          `application_group_id=${o[idKey]} looks like a name; requires applicationId (or applicationName resolved to id)`,
        );
      o[idKey] = await lookupApplicationGroupDatabaseId({
        client,
        applicationId: appId,
        keyword: o[idKey] as string,
        cache: appGroupCache,
      });
    }

    // keep for future expansions
    void idx;
    void ctx.applicationName;
  });
}

export async function resolveDesiredWorkflows(
  client: GraphQLClient,
  workflows: WorkflowDesired[],
  opts: { refreshCatalog?: boolean } = {},
): Promise<WorkflowDesired[]> {
  const { catalog, index } = await loadCatalog(client, {
    refresh: opts.refreshCatalog,
  });
  const appGroupCache = new Map<string, string>();

  return Promise.all(
    workflows.map(async (w) => ({
      ...w,
      memberFilters: w.memberFilters
        ? w.memberFilters.map((f) => ({
            ...f,
            criteria: resolveMemberFilterCriteria(
              index,
              catalog.departments,
              f.criteria,
            ),
          }))
        : undefined,
      tasks: await Promise.all(
        (w.tasks ?? []).map(async (t) => {
          let applicationId = t.applicationId;
          let applicationName = t.applicationName ?? null;

          if (!applicationId && t.applicationName) {
            const id = resolveApplicationId(index, t.applicationName);
            if (!id)
              throw new Error(
                `Cannot resolve applicationName=${t.applicationName} to id`,
              );
            applicationId = id;
          }

          if (!applicationName && applicationId) {
            applicationName = resolveApplicationName(index, applicationId);
          }

          return {
            ...t,
            applicationId,
            params:
              t.params !== undefined
                ? await resolveTaskParams(
                    index,
                    client,
                    t.params,
                    { applicationId: applicationId ?? null, applicationName },
                    appGroupCache,
                  )
                : undefined,
          };
        }),
      ),
    })),
  );
}
