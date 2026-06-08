import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatMaps, chats, maps } from "@/lib/schema";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const mapIds: string[] = Array.isArray(body?.mapIds)
    ? body.mapIds.filter((x: unknown) => typeof x === "string")
    : [];
  if (mapIds.length === 0) {
    return NextResponse.json({ error: "Select at least one map." }, { status: 400 });
  }

  // Only the user's own maps.
  const owned = await db
    .select({ id: maps.id, title: maps.title })
    .from(maps)
    .where(and(eq(maps.userId, user.id), inArray(maps.id, mapIds)));
  if (owned.length === 0) {
    return NextResponse.json({ error: "No valid maps selected." }, { status: 400 });
  }

  const title =
    (typeof body?.title === "string" && body.title.trim()) ||
    (owned.length === 1 ? owned[0].title : `${owned.length} maps`);

  const [chat] = await db.insert(chats).values({ userId: user.id, title }).returning();
  await db.insert(chatMaps).values(owned.map((o) => ({ chatId: chat.id, mapId: o.id })));

  return NextResponse.json({ id: chat.id });
}
