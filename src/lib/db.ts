import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Netlify DB (Neon) injects NETLIFY_DATABASE_URL automatically; locally we use
// DATABASE_URL from .env.local. Accept either.
const connectionString =
  process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;

if (!connectionString) {
  // Surfaced clearly instead of a confusing runtime crash deep in a query.
  console.warn(
    "[db] No database URL set. On Netlify this comes from NETLIFY_DATABASE_URL; locally, add DATABASE_URL to .env.local.",
  );
}

// A syntactically valid placeholder so the app can build without a real DB.
// neon() only validates the URL format here; it does not connect until a query
// runs (which, in production, happens with the real DATABASE_URL set).
const PLACEHOLDER = "postgresql://user:password@localhost/placeholder";

const sql = neon(connectionString ?? PLACEHOLDER);
export const db = drizzle(sql, { schema });
