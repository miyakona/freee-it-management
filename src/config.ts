import { z } from "zod";

const EnvSchema = z.object({
  FREEE_IT_GRAPHQL_ENDPOINT: z.string().url(),
  FREEE_IT_TOKEN: z.string().min(1),
  FREEE_IT_SCHEMA_PATH: z.string().min(1).default("./schema.json"),
  FREEE_IT_TEAM_ID: z.string().min(1).optional(),
  FREEE_IT_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const raw = {
    FREEE_IT_GRAPHQL_ENDPOINT: process.env.FREEE_IT_GRAPHQL_ENDPOINT,
    FREEE_IT_TOKEN: process.env.FREEE_IT_TOKEN,
    FREEE_IT_SCHEMA_PATH: process.env.FREEE_IT_SCHEMA_PATH,
    FREEE_IT_TEAM_ID: process.env.FREEE_IT_TEAM_ID,
    FREEE_IT_HTTP_TIMEOUT_MS: process.env.FREEE_IT_HTTP_TIMEOUT_MS,
  };
  return EnvSchema.parse(raw);
}
