import fs from "node:fs";
import path from "node:path";
import type { GraphQLClient } from "graphql-request";
import { GQL } from "../freee/documents.js";
import { withRetry } from "../freee/graphqlClient.js";

export type IdCatalog = {
  fetchedAt: string; // ISO
  applications: Array<{ id: string; name: string }>;
  departments: Array<{
    databaseId: string;
    fullName: string;
    name: string;
  }>;
};

export type CatalogIndex = {
  applicationIdsByName: Map<string, string[]>;
  applicationNameById: Map<string, string>;
  departmentDatabaseIdByFullName: Map<string, string>;
  departmentDatabaseIdByUniqueName: Map<string, string>;
  departmentFullNameByDatabaseId: Map<string, string>;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function cachePath(): string {
  return path.resolve(process.cwd(), ".freee-it", "catalog.json");
}

function readCache(maxAgeMs: number): IdCatalog | null {
  const p = cachePath();
  try {
    const st = fs.statSync(p);
    const age = Date.now() - st.mtimeMs;
    if (age > maxAgeMs) return null;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as IdCatalog;
  } catch {
    return null;
  }
}

function writeCache(c: IdCatalog) {
  const p = cachePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

function buildIndex(c: IdCatalog): CatalogIndex {
  const applicationIdsByName = new Map<string, string[]>();
  const applicationNameById = new Map<string, string>();
  for (const a of c.applications) {
    const k = norm(a.name);
    applicationIdsByName.set(k, [...(applicationIdsByName.get(k) ?? []), a.id]);
    applicationNameById.set(a.id, a.name);
  }

  const departmentDatabaseIdByFullName = new Map<string, string>();
  const departmentFullNameByDatabaseId = new Map<string, string>();
  const nameCounts = new Map<string, number>();
  for (const d of c.departments) {
    departmentDatabaseIdByFullName.set(norm(d.fullName), d.databaseId);
    departmentFullNameByDatabaseId.set(d.databaseId, d.fullName);
    nameCounts.set(norm(d.name), (nameCounts.get(norm(d.name)) ?? 0) + 1);
  }
  const departmentDatabaseIdByUniqueName = new Map<string, string>();
  for (const d of c.departments) {
    if ((nameCounts.get(norm(d.name)) ?? 0) === 1)
      departmentDatabaseIdByUniqueName.set(norm(d.name), d.databaseId);
  }

  return {
    applicationIdsByName,
    applicationNameById,
    departmentDatabaseIdByFullName,
    departmentDatabaseIdByUniqueName,
    departmentFullNameByDatabaseId,
  };
}

export async function loadCatalog(
  client: GraphQLClient,
  opts: { cacheMaxAgeMs?: number; refresh?: boolean } = {},
): Promise<{ catalog: IdCatalog; index: CatalogIndex }> {
  const cacheMaxAgeMs = opts.cacheMaxAgeMs ?? 24 * 60 * 60 * 1000;
  const cached = opts.refresh ? null : readCache(cacheMaxAgeMs);
  if (cached) return { catalog: cached, index: buildIndex(cached) };

  const fetched = await fetchCatalogRemote(client);
  writeCache(fetched);
  return { catalog: fetched, index: buildIndex(fetched) };
}

async function fetchCatalogRemote(client: GraphQLClient): Promise<IdCatalog> {
  const applications: Array<{ id: string; name: string }> = [];
  const departments: IdCatalog["departments"] = [];

  // applications
  let afterApps: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await withRetry(() =>
      client.request<{
        team: {
          applications: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            nodes: Array<{
              id: string;
              name: string;
            }>;
          };
        };
      }>(GQL.catalogApplications, { first: 50, after: afterApps }),
    );

    for (const a of res.team.applications.nodes) {
      applications.push({ id: a.id, name: a.name });
    }

    if (!res.team.applications.pageInfo.hasNextPage) break;
    afterApps = res.team.applications.pageInfo.endCursor;
  }

  // departments (paginate)
  let afterDeps: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await withRetry(() =>
      client.request<{
        team: {
          departments: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            nodes: Array<{
              databaseId: string;
              fullName: string;
              name: string;
            }>;
          };
        };
      }>(GQL.catalogDepartments, { first: 200, after: afterDeps }),
    );
    departments.push(...res.team.departments.nodes);
    if (!res.team.departments.pageInfo.hasNextPage) break;
    afterDeps = res.team.departments.pageInfo.endCursor;
  }

  return {
    fetchedAt: new Date().toISOString(),
    applications,
    departments,
  };
}
