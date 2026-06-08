import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import DashboardClient from "@/components/DashboardClient";
import Header from "@/components/Header";
import UploadForm from "@/components/UploadForm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatMaps, chats, maps } from "@/lib/schema";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const mapRows = await db
    .select({ id: maps.id, title: maps.title, kind: maps.kind })
    .from(maps)
    .where(eq(maps.userId, user.id))
    .orderBy(desc(maps.createdAt));

  const chatRows = await db
    .select({ id: chats.id, title: chats.title, createdAt: chats.createdAt })
    .from(chats)
    .where(eq(chats.userId, user.id))
    .orderBy(desc(chats.createdAt));

  const countRows = await db
    .select({ chatId: chatMaps.chatId, c: sql<number>`count(*)::int` })
    .from(chatMaps)
    .innerJoin(chats, eq(chatMaps.chatId, chats.id))
    .where(eq(chats.userId, user.id))
    .groupBy(chatMaps.chatId);
  const counts = new Map(countRows.map((r) => [r.chatId, Number(r.c)]));

  const chatsData = chatRows.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    mapCount: counts.get(c.id) ?? 0,
  }));

  return (
    <>
      <Header userName={user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Hello, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload maps, then pick one or more to <span className="brand-text font-semibold">chat with the AI</span> about them.
        </p>

        <div className="mt-6">
          <UploadForm />
        </div>

        <div className="mt-10">
          <DashboardClient maps={mapRows} chats={chatsData} />
        </div>
      </main>
    </>
  );
}
