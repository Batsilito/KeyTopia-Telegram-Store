import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl =
  process.env.Neon_Connection ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Neon_Connection must be set. DATABASE_URL is supported as a fallback.",
  );
}

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });

export * from "./schema";
