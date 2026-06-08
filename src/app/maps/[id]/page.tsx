import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MapChat from "@/components/MapChat";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps, messages } from "@/lib/schema";

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

export default async function MapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, id), eq(maps.userId, user.id)))
    .limit(1);
  if (!map) notFound();

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.mapId, map.id))
    .orderBy(asc(messages.createdAt));

  const fileUrl = `/api/maps/${map.id}/file`;

  return (
    <>
      <Header userName={user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-sm text-sky-700 hover:underline">
              ← All maps
            </Link>
            <h1 className="text-xl font-semibold text-slate-900">{map.title}</h1>
            <p className="text-xs text-slate-500">{map.fileName}</p>
          </div>
          <div className="flex gap-2">
            <a
              href={`/api/maps/${map.id}/report?format=docx`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ⬇ Word report
            </a>
            <a
              href={`/api/maps/${map.id}/report?format=pdf`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ⬇ PDF report
            </a>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            {map.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl}
                alt={map.title}
                className="max-h-[70vh] w-full rounded object-contain"
              />
            ) : map.kind === "pdf" ? (
              <iframe src={fileUrl} className="h-[70vh] w-full rounded" title={map.title} />
            ) : (
              <div className="p-6 text-center text-sm text-slate-500">
                Preview not available for this file type.{" "}
                <a href={fileUrl} className="text-sky-700 hover:underline">
                  Download original
                </a>
              </div>
            )}
          </section>

          <section className="h-[70vh]">
            <MapChat
              mapId={map.id}
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
