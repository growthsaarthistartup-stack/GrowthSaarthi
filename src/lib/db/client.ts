/**
 * Neon Postgres client — singleton pattern safe for Next.js Edge / serverless.
 *
 * Usage:
 *   import { db } from "@/lib/db/client";
 *   const rows = await db.select().from(startups).where(eq(startups.id, id));
 *
 * Set DATABASE_URL in .env.local to your Neon connection string:
 *   DATABASE_URL="postgresql://user:password@host.neon.tech/dbname?sslmode=require"
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string to .env.local",
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

// Lazy singleton — only resolves (and only throws) when db is first accessed.
// This allows test files that import only pure functions to load without DATABASE_URL.
const globalForDb = globalThis as unknown as { _db?: ReturnType<typeof createDb> };

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    if (!globalForDb._db) {
      globalForDb._db = createDb();
    }
    return Reflect.get(globalForDb._db, prop, receiver);
  },
});


export type Database = typeof db;
