import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { answerAboutMap, vision, type ChatTurn, type MapInput } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildReport } from "@/lib/reports";
import { chatMaps, chats, maps, messages, reports } from "@/lib/schema";
import { getFile, putFile } from "@/lib/storage";
import { chatSchema } from "@/lib/validation";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: chatId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid question" },
      { status: 400 },
    );
  }
  const question = parsed.data.question;

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)))
    .limit(1);
  if (!chat) return NextResponse.json({ error: "Chat not found." }, { status: 404 });

  // Load the chat's maps (only images get vision; build buffers + cached overviews).
  const mapRows = await db
    .select({
      id: maps.id,
      title: maps.title,
      fileName: maps.fileName,
      mimeType: maps.mimeType,
      blobKey: maps.blobKey,
      kind: maps.kind,
      analysis: maps.analysis,
    })
    .from(chatMaps)
    .innerJoin(maps, eq(chatMaps.mapId, maps.id))
    .where(eq(chatMaps.chatId, chat.id));

  const mapInputs: MapInput[] = [];
  const allImages: Buffer[] = [];
  const overviews: string[] = [];

  for (const m of mapRows) {
    const bytes = await getFile(m.blobKey);
    if (!bytes) continue;
    const name = m.title || m.fileName;
    if (m.kind === "image") {
      mapInputs.push({ name, buffer: bytes });
      allImages.push(bytes);
      let ov = m.analysis ?? undefined;
      if (!ov) {
        try {
          ov = await vision(
            bytes,
            "full",
            "Concise overview of this map: title, region, main rivers/water bodies, and type of map.",
          );
          await db.update(maps).set({ analysis: ov }).where(eq(maps.id, m.id));
        } catch {
          /* tolerate */
        }
      }
      if (ov) overviews.push(`Map "${name}": ${ov}`);
    }
  }

  const prior = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chat.id))
    .orderBy(asc(messages.createdAt));
  const history: ChatTurn[] = prior.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  let answer: string;
  let steps;
  let report;
  try {
    ({ answer, steps, report } = await answerAboutMap({
      question,
      maps: mapInputs,
      overview: overviews.join("\n\n") || undefined,
      history,
      forceReport:
        /\b(report|briefing|write[- ]?up|summary document|generate (a |an )?(report|document|brief)|word doc|pdf)\b/i.test(
          question,
        ),
      onCreateReport: async ({ title, body }) => {
        const { docx, pdf } = await buildReport(title, body, allImages);
        const docxKey = randomUUID();
        const pdfKey = randomUUID();
        await putFile(docxKey, docx);
        await putFile(pdfKey, pdf);
        const [row] = await db
          .insert(reports)
          .values({ chatId: chat.id, userId: user.id, title, docxKey, pdfKey })
          .returning();
        return { id: row.id };
      },
    }));
  } catch (err) {
    console.error("[chat] answer step failed", err);
    return NextResponse.json(
      { error: "The AI service did not respond. Check your API keys and try again." },
      { status: 502 },
    );
  }

  await db.insert(messages).values([
    { chatId: chat.id, userId: user.id, role: "user", content: question },
    {
      chatId: chat.id,
      userId: user.id,
      role: "assistant",
      content: answer,
      meta: JSON.stringify(steps ?? []),
    },
  ]);

  return NextResponse.json({ answer, steps, report });
}
