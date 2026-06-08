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
    <div className="space-y-8">
      {chats.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent chats
          </h2>
          <ul className="mt-3 space-y-2">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chats/${c.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-sky-300 hover:bg-sky-50/40"
                >
                  <span className="font-medium text-slate-900">💬 {c.title}</span>
                  <span className="text-xs text-slate-400">
                    {c.mapCount} map{c.mapCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your maps — select to chat
          </h2>
          <span className="text-xs text-slate-400">{selected.size} selected</span>
        </div>

        {maps.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No maps yet. Upload some above, then select them to start a chat.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {maps.map((m) => {
              const on = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={
                    "group relative overflow-hidden rounded-lg border bg-white text-left transition " +
                    (on ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200 hover:border-slate-300")
                  }
                >
                  <div className="aspect-[4/3] bg-slate-50">
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/maps/${m.id}/file`}
                        alt={m.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-3xl">
                        {m.kind === "pdf" ? "📄" : "🗂️"}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-2 py-2">
                    <span
                      className={
                        "flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] " +
                        (on ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300")
                      }
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="truncate text-xs font-medium text-slate-700">{m.title}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </section>

      {selected.size > 0 && (
        <div className="sticky bottom-4 flex justify-center">
          <button
            onClick={startChat}
            disabled={loading}
            className="rounded-full bg-sky-700 px-6 py-3 text-sm font-medium text-white shadow-lg hover:bg-sky-800 disabled:opacity-60"
          >
            {loading
              ? "Starting…"
              : `Start chat with ${selected.size} map${selected.size === 1 ? "" : "s"} →`}
          </button>
        </div>
      )}
    </div>
  );
}
