import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps } from "@/lib/schema";
import { getFile } from "@/lib/storage";

/** Streams the raw bytes of an uploaded map, but only to its owner. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, id), eq(maps.userId, user.id)))
    .limit(1);
  if (!map) return new NextResponse("Not found", { status: 404 });

  const bytes = await getFile(map.blobKey);
  if (!bytes) return new NextResponse("File missing", { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": map.mimeType,
      "Content-Disposition": `inline; filename="${map.fileName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
