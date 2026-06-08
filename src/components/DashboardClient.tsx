"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type MapItem = { id: string; title: string; kind: string };
type ChatItem = { id: string; title: string; mapCount: number; createdAt: string };

export default function DashboardClient({
  maps,
  chats,
}: {
  maps: MapItem[];
  chats: ChatItem[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function startChat() {
    if (selected.size === 0) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapIds: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not start chat.");
        return;
      }
      router.push(`/chats/${data.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-10 pb-24">
      {chats.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Recent chats
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chats/${c.id}`}
                  className="panel flex items-center gap-3 px-4 py-3.5 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-50 text-lg">
                    💬
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{c.title}</span>
                    <span className="text-xs text-slate-400">
                      {c.mapCount} map{c.mapCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-slate-300">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Your maps {maps.length > 0 && `(${maps.length})`}
          </h2>
          {maps.length > 0 && (
            <span className="text-xs text-slate-400">
              Select maps to chat · {selected.size} chosen
            </span>
          )}
        </div>

        {maps.length === 0 ? (
          <div className="panel flex flex-col items-center justify-center px-6 py-14 text-center">
            <span className="text-4xl">🗺️</span>
            <p className="mt-3 font-medium text-slate-700">No maps yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Upload maps above, then select them to start a chat.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {maps.map((m) => {
              const on = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={
                    "panel group relative overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:shadow-md " +
                    (on ? "ring-2 ring-brand-500 ring-offset-2" : "")
                  }
                >
                  <div className="relative aspect-[4/3] bg-slate-100">
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/maps/${m.id}/file`}
                        alt={m.title}
                        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-4xl">
                        {m.kind === "pdf" ? "📄" : "🗂️"}
                      </div>
                    )}
                    <span
                      className={
                        "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs shadow-sm transition " +
                        (on
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-white/70 bg-white/80 text-transparent")
                      }
                    >
                      ✓
                    </span>
                  </div>
                  <p className="truncate px-3 py-2.5 text-xs font-medium text-slate-700">
                    {m.title}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
        )}
      </section>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
          <button onClick={startChat} disabled={loading} className="btn-primary px-7 py-3.5 shadow-xl">
            {loading
              ? "Starting…"
              : `Start chat with ${selected.size} map${selected.size === 1 ? "" : "s"} →`}
          </button>
        </div>
      )}
    </div>
  );
}
