import { eq } from "drizzle-orm";
import { db } from "./db";
import { fileBlobs } from "./schema";

/**
 * File storage for uploaded maps.
 *
 * Files are stored as base64 in the database (the `file_blobs` table). This
 * works on any host — including serverless platforms like Vercel and Netlify,
 * which have no persistent writable filesystem. Keyed by maps.blobKey.
 */

export async function putFile(key: string, data: Buffer): Promise<void> {
  const dataBase64 = data.toString("base64");
  await db
    .insert(fileBlobs)
    .values({ key, dataBase64 })
    .onConflictDoUpdate({ target: fileBlobs.key, set: { dataBase64 } });
}

export async function getFile(key: string): Promise<Buffer | null> {
  const [row] = await db
    .select()
    .from(fileBlobs)
    .where(eq(fileBlobs.key, key))
    .limit(1);
  return row ? Buffer.from(row.dataBase64, "base64") : null;
}

export async function deleteFile(key: string): Promise<void> {
  await db.delete(fileBlobs).where(eq(fileBlobs.key, key));
}
