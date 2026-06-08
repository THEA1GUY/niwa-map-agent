import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Surfaced clearly instead of a confusing runtime crash deep in a query.
  console.warn(
    "[db] DATABASE_URL is not set. Copy .env.example to .env.local and add your Netlify DB / Neon connection string.",
  );
}

// A syntactically valid placeholder so the app can build without a real DB.
// neon() only validates the URL format here; it does not connect until a query
// runs (which, in production, happens with the real DATABASE_URL set).
const PLACEHOLDER = "postgresql://user:password@localhost/placeholder";

const sql = neon(connectionString ?? PLACEHOLDER);
export const db = drizzle(sql, { schema });
