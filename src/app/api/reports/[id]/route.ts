import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reports } from "@/lib/schema";
import { getFile } from "@/lib/storage";

function safeName(title: string): string {
  return title.replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_") || "report";
}

/** Download a report the AI generated, as Word or PDF, owner only. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "docx";

  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, id), eq(reports.userId, user.id)))
    .limit(1);
  if (!row) return new NextResponse("Not found", { status: 404 });

  const key = format === "pdf" ? row.pdfKey : row.docxKey;
  const bytes = await getFile(key);
  if (!bytes) return new NextResponse("Report file missing", { status: 404 });

  const base = safeName(row.title);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
    },
  });
}
