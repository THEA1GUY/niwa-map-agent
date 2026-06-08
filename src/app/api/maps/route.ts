import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps } from "@/lib/schema";
import { putFile } from "@/lib/storage";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file

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
  const files = (form?.getAll("file") ?? []).filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (files.some((f) => f.size > MAX_BYTES)) {
    return NextResponse.json({ error: "Each file must be 15 MB or smaller." }, { status: 413 });
  }

  const ids: string[] = [];
  for (const file of files) {
    const blobKey = randomUUID();
    await putFile(blobKey, Buffer.from(await file.arrayBuffer()));
    const [row] = await db
      .insert(maps)
      .values({
        userId: user.id,
        title: file.name || "Untitled map",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        blobKey,
        kind: kindFor(file.type),
      })
      .returning({ id: maps.id });
    ids.push(row.id);
  }

  return NextResponse.json({ ids });
}
