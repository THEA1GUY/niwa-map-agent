import { getStore } from "@netlify/blobs";
import { promises as fs } from "fs";
import path from "path";

/**
 * File storage for uploaded maps.
 * - On Netlify: uses Netlify Blobs (managed, no server).
 * - Locally (dev): falls back to a .data/uploads folder (gitignored).
 */

const LOCAL_DIR = path.join(process.cwd(), ".data", "uploads");
const STORE_NAME = "maps";

function onNetlify(): boolean {
  return Boolean(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT);
}

export async function putFile(key: string, data: Buffer): Promise<void> {
  if (onNetlify()) {
    const store = getStore(STORE_NAME);
    // Netlify Blobs wants an ArrayBuffer; convert the Node Buffer's bytes.
    const ab = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    await store.set(key, ab);
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, key), data);
}

export async function getFile(key: string): Promise<Buffer | null> {
  if (onNetlify()) {
    const store = getStore(STORE_NAME);
    const ab = await store.get(key, { type: "arrayBuffer" });
    return ab ? Buffer.from(ab) : null;
  }
  try {
    return await fs.readFile(path.join(LOCAL_DIR, key));
  } catch {
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (onNetlify()) {
    const store = getStore(STORE_NAME);
    await store.delete(key);
    return;
  }
  try {
    await fs.unlink(path.join(LOCAL_DIR, key));
  } catch {
    /* already gone */
  }
}
