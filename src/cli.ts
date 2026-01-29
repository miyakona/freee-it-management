import "dotenv/config";
import { Command } from "commander";
import * as yaml from "js-yaml";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./config.js";
import { createGraphQLClient } from "./freee/graphqlClient.js";
import { GQL } from "./freee/documents.js";
import { buildSpecSchema } from "./spec/spec.js";
import { loadSpecFile } from "./spec/loadSpec.js";
import {
  applyWorkflows,
  listAllWorkflows,
  planWorkflows,
} from "./resources/workflows.js";
import { resolveDesiredWorkflows } from "./resources/resolveSpec.js";
import { loadCatalog } from "./resources/catalog.js";
import { withRetry } from "./freee/graphqlClient.js";

function getCliVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("freee-it")
  .description("freee IT管理 GraphQL CLI")
  .version(getCliVersion());

const INTROSPECTION_QUERY = /* GraphQL */ `
  query IntrospectionQuery {
    __schema {
      queryType {
        name
      }
      mutationType {
        name
      }
      types {
        kind
        name
        description
        fields(includeDeprecated: true) {
          name
          description
          args {
            name
            description
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
            defaultValue
          }
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
          isDeprecated
          deprecationReason
        }
        inputFields {
          name
          description
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
          defaultValue
        }
        enumValues(includeDeprecated: true) {
          name
          description
          isDeprecated
          deprecationReason
        }
        possibleTypes {
          kind
          name
          ofType {
            kind
            name
          }
        }
      }
    }
  }
`;

program
  .command("schema")
  .description("GraphQL schema (introspection) 操作")
  .command("fetch")
  .description("introspection を取得して schema.json を生成")
  .option(
    "-o, --out <path>",
    "出力先（デフォルト: ./schema.json）",
    "./schema.json",
  )
  .action(async (opts) => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });

    const res = await client.request(INTROSPECTION_QUERY);
    fs.writeFileSync(opts.out, JSON.stringify({ data: res }, null, 0));
    process.stdout.write(`Wrote ${opts.out}\n`);
  });

program
  .command("export")
  .description("現状の Workflow を YAML で出力")
  .option("-o, --out <path>", "出力先ファイル（省略でstdout）")
  .option("--ids", "内部IDをそのまま出力する（名前変換しない）", false)
  .option("--refresh-catalog", "名前変換用カタログを再取得する", false)
  .action(async (opts) => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });

    const workflows = await listAllWorkflows(client);

    const useNames = !Boolean(opts.ids);
    const catalogBundle = useNames
      ? await loadCatalog(client, { refresh: Boolean(opts.refreshCatalog) })
      : null;
    const deptFullNameByDbId =
      catalogBundle?.index.departmentFullNameByDatabaseId;

    const appNameCounts = new Map<string, number>();
    if (catalogBundle) {
      for (const a of catalogBundle.catalog.applications) {
        appNameCounts.set(a.name, (appNameCounts.get(a.name) ?? 0) + 1);
      }
    }

    const looksLikeUuid = (x: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

    const mapJson = (
      x: unknown,
      fn: (o: Record<string, unknown>) => void,
    ): unknown => {
      if (!x || typeof x !== "object") return x;
      if (Array.isArray(x)) return x.map((v) => mapJson(v, fn));
      const o = x as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) next[k] = mapJson(v, fn);
      fn(next);
      return next;
    };

    const dehydrateMemberFilterCriteria = (criteria: unknown): unknown => {
      if (!useNames || !deptFullNameByDbId) return criteria;
      return mapJson(criteria, (o) => {
        if (o.attribute_name !== "department") return;
        if (typeof o.value !== "string") return;
        if (!looksLikeUuid(o.value)) return;
        const fullName = deptFullNameByDbId.get(o.value);
        if (!fullName) return;
        o.value_name = fullName;
        delete o.value;
      });
    };

    const applicationGroupNameByDbIdByAppId = new Map<
      string,
      Map<string, string>
    >();

    const loadAppGroups = async (applicationId: string) => {
      const cached = applicationGroupNameByDbIdByAppId.get(applicationId);
      if (cached) return cached;
      const m = new Map<string, string>();
      let after: string | null = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await withRetry(() =>
          client.request<{
            node: null | {
              id: string;
              name: string;
              groups: {
                pageInfo: { endCursor: string | null; hasNextPage: boolean };
                nodes: Array<{ databaseId: string; name: string }>;
              };
            };
          }>(GQL.listApplicationGroups, { applicationId, first: 100, after }),
        );
        const app = res.node;
        if (!app) break;
        for (const g of app.groups.nodes) m.set(g.databaseId, g.name);
        if (!app.groups.pageInfo.hasNextPage) break;
        after = app.groups.pageInfo.endCursor;
      }
      applicationGroupNameByDbIdByAppId.set(applicationId, m);
      return m;
    };

    const dehydrateTaskParams = async (
      applicationId: string,
      params: unknown,
    ) => {
      if (!useNames) return params;
      const groupMap = await loadAppGroups(applicationId);
      return mapJson(params, (o) => {
        const idKey = "application_group_id";
        const nameKey = "application_group_name";
        if (typeof o[idKey] !== "string") return;
        const v = o[idKey] as string;
        if (!looksLikeUuid(v)) return;
        const name = groupMap.get(v);
        if (!name) return;
        o[nameKey] = name;
        delete o[idKey];
      });
    };

    const exported = {
      workflows: await Promise.all(
        workflows.map(async (w) => ({
          id: useNames ? undefined : w.id,
          name: w.name,
          triggerKind: w.triggerKind,
          argumentKind: w.argumentKind ?? undefined,
          executionKind: w.executionKind ?? undefined,
          viewerKind: w.viewerKind ?? undefined,
          status: w.status ?? undefined,
          memberFilters:
            (w.memberFilters ?? []).length > 0
              ? (w.memberFilters ?? []).map((f) => ({
                  criteria: dehydrateMemberFilterCriteria(
                    f.memberFilterCriteria.criteria,
                  ),
                }))
              : undefined,
          schedule: w.workflowScheduleSetting
            ? {
                referenceDateKind: w.workflowScheduleSetting.referenceDateKind,
                differenceDate: w.workflowScheduleSetting.differenceDate,
                time: w.workflowScheduleSetting.time,
              }
            : undefined,
          tasks: await Promise.all(
            (w.tasks ?? [])
              .sort((a, b) => a.order - b.order)
              .map(async (t) => {
                const applicationName = t.application.name;
                const applicationId = t.application.id;
                return {
                  applicationId: useNames
                    ? (appNameCounts.get(applicationName) ?? 0) > 1
                      ? applicationId
                      : undefined
                    : applicationId,
                  applicationName: useNames ? applicationName : undefined,
                  actionName: t.actionName,
                  params:
                    t.params !== undefined
                      ? useNames
                        ? await dehydrateTaskParams(applicationId, t.params)
                        : t.params
                      : undefined,
                };
              }),
          ),
        })),
      ),
    };

    const out = yaml.dump(exported, { noRefs: true, lineWidth: -1 });
    if (opts.out) fs.writeFileSync(opts.out, out);
    else process.stdout.write(out);
  });

const catalog = program
  .command("catalog")
  .description("ID解決用カタログ（名前->内部ID）");

catalog
  .command("pull")
  .description("カタログを再取得してローカルキャッシュに保存")
  .action(async () => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });
    await loadCatalog(client, { refresh: true });
    process.stdout.write("OK\n");
  });

catalog
  .command("applications")
  .description("アプリ一覧（name/id）")
  .option("-q, --query <keyword>", "絞り込み（部分一致）")
  .action(async (opts) => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });
    const { catalog } = await loadCatalog(client);
    const q =
      typeof opts.query === "string" ? opts.query.trim().toLowerCase() : null;
    for (const a of catalog.applications) {
      if (q && !a.name.toLowerCase().includes(q)) continue;
      process.stdout.write(`${a.name}\t${a.id}\n`);
    }
  });

catalog
  .command("departments")
  .description("部署一覧（fullName/databaseId）")
  .option("-q, --query <keyword>", "絞り込み（部分一致）")
  .action(async (opts) => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });
    const { catalog } = await loadCatalog(client);
    const q =
      typeof opts.query === "string" ? opts.query.trim().toLowerCase() : null;
    for (const d of catalog.departments) {
      if (
        q &&
        !d.fullName.toLowerCase().includes(q) &&
        !d.name.toLowerCase().includes(q)
      )
        continue;
      process.stdout.write(`${d.fullName}\t${d.databaseId}\n`);
    }
  });

catalog
  .command("application-groups")
  .description("アプリ内グループ一覧（name/databaseId）")
  .requiredOption(
    "-a, --application <nameOrId>",
    "アプリ名 or Application.id (GraphQL ID)",
  )
  .option("-q, --query <keyword>", "絞り込み（部分一致）", "")
  .action(async (opts) => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });

    const { index } = await loadCatalog(client);
    const appArg = String(opts.application);
    const applicationId = index.applicationNameById.has(appArg)
      ? appArg
      : (index.applicationIdsByName.get(appArg.trim().toLowerCase()) ?? [])[0];
    if (!applicationId)
      throw new Error(`Cannot resolve application=${opts.application}`);

    const keyword = String(opts.query ?? "");
    if (keyword.length === 0) {
      let after: string | null = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await withRetry(() =>
          client.request<{
            node: null | {
              id: string;
              name: string;
              groups: {
                pageInfo: { endCursor: string | null; hasNextPage: boolean };
                nodes: Array<{ databaseId: string; name: string }>;
              };
            };
          }>(GQL.listApplicationGroups, { applicationId, first: 100, after }),
        );
        const app = res.node;
        if (!app) throw new Error(`Application not found: ${applicationId}`);
        for (const g of app.groups.nodes) {
          process.stdout.write(`${g.name}\t${g.databaseId}\n`);
        }
        if (!app.groups.pageInfo.hasNextPage) break;
        after = app.groups.pageInfo.endCursor;
      }
      return;
    }

    const res = await withRetry(() =>
      client.request<{
        node: null | {
          id: string;
          name: string;
          groups: { nodes: Array<{ databaseId: string; name: string }> };
        };
      }>(GQL.lookupApplicationGroups, { applicationId, keyword }),
    );
    const app = res.node;
    if (!app) throw new Error(`Application not found: ${applicationId}`);
    for (const g of app.groups.nodes)
      process.stdout.write(`${g.name}\t${g.databaseId}\n`);
  });

program
  .command("plan")
  .description("YAML/JSON を読み、差分(plan)を表示")
  .requiredOption("-f, --file <path>", "spec ファイル (yaml/json)")
  .option("--prune", "spec に無い task を削除(delete)する", false)
  .option(
    "--ignore-order",
    "順序差分を無視する（workflow/task の reorder をしない）",
    false,
  )
  .option("--refresh-catalog", "ID解決用カタログを再取得する", false)
  .action(async (opts) => {
    const env = loadEnv();
    const specSchema = buildSpecSchema(env.FREEE_IT_SCHEMA_PATH);
    const spec = loadSpecFile(opts.file, specSchema);

    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });
    const remote = await listAllWorkflows(client);

    const desired = await resolveDesiredWorkflows(client, spec.workflows, {
      refreshCatalog: opts.refreshCatalog,
    });
    const ops = planWorkflows(desired, remote, {
      prune: opts.prune,
      ignoreOrder: opts.ignoreOrder,
    });
    if (ops.length === 0) {
      process.stdout.write("No changes.\n");
      return;
    }
    for (const op of ops)
      process.stdout.write(`${op.kind} ${JSON.stringify(op)}\n`);
  });

program
  .command("apply")
  .description("YAML/JSON を読み、差分を適用(apply)")
  .requiredOption("-f, --file <path>", "spec ファイル (yaml/json)")
  .option("--prune", "spec に無い task を削除(delete)する", false)
  .option(
    "--ignore-order",
    "順序差分を無視する（workflow/task の reorder をしない）",
    false,
  )
  .option("--refresh-catalog", "ID解決用カタログを再取得する", false)
  .action(async (opts) => {
    const env = loadEnv();
    const specSchema = buildSpecSchema(env.FREEE_IT_SCHEMA_PATH);
    const spec = loadSpecFile(opts.file, specSchema);

    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });

    const desired = await resolveDesiredWorkflows(client, spec.workflows, {
      refreshCatalog: opts.refreshCatalog,
    });
    await applyWorkflows(client, desired, {
      prune: opts.prune,
      ignoreOrder: opts.ignoreOrder,
    });
    process.stdout.write("Done.\n");
  });

await program.parseAsync(process.argv);
