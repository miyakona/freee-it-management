import "dotenv/config";
import { Command } from "commander";
import * as yaml from "js-yaml";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./config.js";
import { createGraphQLClient } from "./freee/graphqlClient.js";
import { buildSpecSchema } from "./spec/spec.js";
import { loadSpecFile } from "./spec/loadSpec.js";
import {
  applyWorkflows,
  listAllWorkflows,
  planWorkflows,
} from "./resources/workflows.js";

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
  .action(async (opts) => {
    const env = loadEnv();
    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });

    const workflows = await listAllWorkflows(client);
    const exported = {
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        triggerKind: w.triggerKind,
        argumentKind: w.argumentKind ?? undefined,
        executionKind: w.executionKind ?? undefined,
        viewerKind: w.viewerKind ?? undefined,
        status: w.status ?? undefined,
        memberFilters:
          (w.memberFilters ?? []).length > 0
            ? (w.memberFilters ?? []).map((f) => ({
                criteria: f.memberFilterCriteria.criteria,
              }))
            : undefined,
        schedule: w.workflowScheduleSetting
          ? {
              referenceDateKind: w.workflowScheduleSetting.referenceDateKind,
              differenceDate: w.workflowScheduleSetting.differenceDate,
              time: w.workflowScheduleSetting.time,
            }
          : undefined,
        tasks: (w.tasks ?? [])
          .sort((a, b) => a.order - b.order)
          .map((t) => ({
            applicationId: t.application.id,
            actionName: t.actionName,
            params: t.params ?? undefined,
          })),
      })),
    };

    const out = yaml.dump(exported, { noRefs: true, lineWidth: -1 });
    if (opts.out) fs.writeFileSync(opts.out, out);
    else process.stdout.write(out);
  });

program
  .command("plan")
  .description("YAML/JSON を読み、差分(plan)を表示")
  .requiredOption("-f, --file <path>", "spec ファイル (yaml/json)")
  .option("--prune", "spec に無い task を削除(delete)する", false)
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

    const ops = planWorkflows(spec.workflows, remote, { prune: opts.prune });
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
  .action(async (opts) => {
    const env = loadEnv();
    const specSchema = buildSpecSchema(env.FREEE_IT_SCHEMA_PATH);
    const spec = loadSpecFile(opts.file, specSchema);

    const client = createGraphQLClient({
      endpoint: env.FREEE_IT_GRAPHQL_ENDPOINT,
      auth: { token: env.FREEE_IT_TOKEN },
      timeoutMs: env.FREEE_IT_HTTP_TIMEOUT_MS,
    });

    await applyWorkflows(client, spec.workflows, { prune: opts.prune });
    process.stdout.write("Done.\n");
  });

await program.parseAsync(process.argv);
