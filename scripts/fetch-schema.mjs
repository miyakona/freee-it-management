import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated:true){
        name
        description
        args{
          name
          description
          type{ kind name ofType{ kind name ofType{ kind name } } }
          defaultValue
        }
        type{ kind name ofType{ kind name ofType{ kind name } } }
        isDeprecated
        deprecationReason
      }
      inputFields{
        name
        description
        type{ kind name ofType{ kind name ofType{ kind name } } }
        defaultValue
      }
      enumValues(includeDeprecated:true){ name description isDeprecated deprecationReason }
      possibleTypes{ kind name ofType{ kind name } }
    }
  }
}
`;

const endpoint = process.env.FREEE_IT_GRAPHQL_ENDPOINT;
const token = process.env.FREEE_IT_TOKEN;
const outPath = process.env.FREEE_IT_SCHEMA_PATH || "./schema.json";
const force = process.env.FREEE_IT_SCHEMA_FORCE === "1";

function log(msg) {
  process.stdout.write(`[postinstall] ${msg}\n`);
}

if (!endpoint || !token) {
  log(
    "FREEE_IT_GRAPHQL_ENDPOINT / FREEE_IT_TOKEN が無いので schema.json 生成をスキップしました（.env を置いてから `npm run dev -- schema fetch` してください）"
  );
  process.exit(0);
}

if (!force && fs.existsSync(outPath)) {
  log(`${outPath} が既に存在するのでスキップしました（上書きするなら FREEE_IT_SCHEMA_FORCE=1）`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });

try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log(
      `schema fetch failed: ${res.status} ${res.statusText}${
        text ? `\n${text}` : ""
      }`
    );
    process.exit(0);
  }

  const json = await res.json();
  // 既存の CLI が期待する形に揃える: { data: { __schema: ... } }
  fs.writeFileSync(outPath, JSON.stringify(json, null, 0));
  log(`Wrote ${outPath}`);
} catch (err) {
  log(
    `schema.json 生成に失敗したのでスキップしました（install は続行します）: ${
      err instanceof Error ? err.message : String(err)
    }`
  );
  process.exit(0);
}

