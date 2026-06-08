import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { vision, answerAboutMap, type ChatTurn } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps, messages } from "@/lib/schema";
import { getFile } from "@/lib/storage";
import { chatSchema } from "@/lib/validation";

export const maxDuration = 60; // allow time for two model calls

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid question" },
      { status: 400 },
    );
  }
  const question = parsed.data.question;

  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, id), eq(maps.userId, user.id)))
    .limit(1);
  if (!map) return NextResponse.json({ error: "Map not found." }, { status: 404 });

  // 1. Prepare the map for the agent: image maps get the ask_vision tool + a
  //    cached first-pass overview; other files get a text note.
  let imageBuffer: Buffer | undefined;
  let overview = map.analysis ?? undefined;
  let textContext: string | undefined;

  if (map.kind === "image") {
    const bytes = await getFile(map.blobKey);
    if (bytes) {
      imageBuffer = bytes;
      if (!overview) {
        try {
          overview = await vision(
            bytes,
            "full",
            "Give a concise overview of this map: its title, the region it covers, the main rivers and water bodies, and what type of map it is.",
          );
          await db.update(maps).set({ analysis: overview }).where(eq(maps.id, map.id));
        } catch (err) {
          console.error("[chat] vision overview failed", err);
        }
      }
    }
  } else {
    textContext = `The uploaded file "${map.fileName}" is a ${map.kind.toUpperCase()} file. Direct content extraction for this file type is not available yet (planned for a later phase), so answer using general waterways/cartographic knowledge and clearly note this limitation.`;
  }

  // 2. Load recent conversation history.
  const prior = await db
    .select()
    .from(messages)
    .where(eq(messages.mapId, map.id))
    .orderBy(asc(messages.createdAt));
  const history: ChatTurn[] = prior.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  // 3. Agentic answer: reasoning model can query the vision model as needed.
  let answer: string;
  try {
    answer = await answerAboutMap({ question, imageBuffer, overview, textContext, history });
  } catch (err) {
    console.error("[chat] answer step failed", err);
    return NextResponse.json(
      { error: "The AI service did not respond. Check your API keys and try again." },
      { status: 502 },
    );
  }

  // 4. Persist both turns.
  await db.insert(messages).values([
    { mapId: map.id, userId: user.id, role: "user", content: question },
    { mapId: map.id, userId: user.id, role: "assistant", content: answer },
  ]);

  return NextResponse.json({ answer });
}
