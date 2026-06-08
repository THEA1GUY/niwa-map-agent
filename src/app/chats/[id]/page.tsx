import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MapChat from "@/components/MapChat";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatMaps, chats, maps, messages } from "@/lib/schema";

type Step = {
  kind: "vision" | "osm";
  label: string;
  query: string;
  thumbnail?: string;
  finding: string;
};

function safeParseSteps(meta: string): Step[] | undefined {
  try {
    const parsed = JSON.parse(meta);
    return Array.isArray(parsed) && parsed.length ? (parsed as Step[]) : undefined;
  } catch {
    return undefined;
  }
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, user.id)))
    .limit(1);
  if (!chat) notFound();

  const mapRows = await db
    .select({ id: maps.id, title: maps.title, fileName: maps.fileName, kind: maps.kind })
    .from(chatMaps)
    .innerJoin(maps, eq(chatMaps.mapId, maps.id))
    .where(eq(chatMaps.chatId, chat.id));

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chat.id))
    .orderBy(asc(messages.createdAt));

  return (
    <>
      <Header userName={user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5">
          <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
            ← All chats
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{chat.title}</h1>
          <p className="text-xs text-slate-500">
            {mapRows.length} map{mapRows.length === 1 ? "" : "s"} in this chat
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            {mapRows.map((m) => (
              <div key={m.id} className="panel p-2">
                <p className="px-1 pb-2 text-xs font-medium text-slate-600">{m.title}</p>
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/maps/${m.id}/file`}
                    alt={m.title}
                    className="max-h-[60vh] w-full rounded object-contain"
                  />
                ) : m.kind === "pdf" ? (
                  <iframe
                    src={`/api/maps/${m.id}/file`}
                    className="h-[60vh] w-full rounded"
                    title={m.title}
                  />
                ) : (
                  <a
                    href={`/api/maps/${m.id}/file`}
                    className="block p-4 text-sm text-sky-700 hover:underline"
                  >
                    Download {m.fileName}
                  </a>
                )}
              </div>
            ))}
          </section>

          <section className="h-[75vh] lg:sticky lg:top-6">
            <MapChat
              chatId={chat.id}
              initialMessages={msgs.map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
                steps: m.meta ? safeParseSteps(m.meta) : undefined,
              }))}
            />
          </section>
        </div>
      </main>
    </>
  );
}
