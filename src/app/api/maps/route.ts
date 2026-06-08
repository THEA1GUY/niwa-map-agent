import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps } from "@/lib/schema";
import { putFile } from "@/lib/storage";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function kindFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "data";
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File is too large (max 15 MB)." },
      { status: 413 },
    );
  }

  const title =
    (typeof form?.get("title") === "string" && (form.get("title") as string).trim()) ||
    file.name ||
    "Untitled map";

  const blobKey = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  await putFile(blobKey, buffer);

  const [row] = await db
    .insert(maps)
    .values({
      userId: user.id,
      title,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      blobKey,
      kind: kindFor(file.type),
    })
    .returning();

  return NextResponse.json({ id: row.id });
}
