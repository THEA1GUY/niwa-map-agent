import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps, messages } from "@/lib/schema";
import { buildDocx, buildPdf } from "@/lib/reports";
import { getFile } from "@/lib/storage";

function safeName(title: string): string {
  return title.replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_") || "report";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "docx";

  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, id), eq(maps.userId, user.id)))
    .limit(1);
  if (!map) return new NextResponse("Not found", { status: 404 });

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.mapId, map.id))
    .orderBy(asc(messages.createdAt));

  const imageBytes = map.kind === "image" ? await getFile(map.blobKey) : null;
  const base = safeName(map.title);

  if (format === "pdf") {
    const pdf = await buildPdf(map, msgs, imageBytes);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
      },
    });
  }

  const docx = await buildDocx(map, msgs, imageBytes);
  return new NextResponse(new Uint8Array(docx), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${base}.docx"`,
    },
  });
}
