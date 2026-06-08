"use client";

import { useEffect, useRef, useState } from "react";

type Step = {
  kind: "vision" | "osm" | "web";
  label: string;
  query: string;
  thumbnail?: string;
  finding: string;
};
type Report = { id: string; title: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  report?: Report;
};

export default function MapChat({
  chatId,
  initialMessages,
}: {
  chatId: string;
  initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = inputRef.current?.value.trim();
    if (!question) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", content: question }]);
    if (inputRef.current) inputRef.current.value = "";
    setLoading(true);
    try {
      const res = await fetch(`/api/chats/${chatId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.answer, steps: data.steps, report: data.report },
      ]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm">
          🌊
        </span>
        <span className="text-sm font-semibold text-slate-700">Map Assistant</span>
      </div>

      <div className="scroll-soft flex-1 space-y-5 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-sm pt-8 text-center">
            <p className="text-3xl">🗺️</p>
            <p className="mt-2 text-sm font-medium text-slate-600">Ask about your maps</p>
            <p className="mt-1 text-xs text-slate-400">
              e.g. “List the rivers and their sources, with coordinates” or “Compare these maps and
              write a short report.”
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={"flex flex-col gap-2 " + (m.role === "user" ? "items-end" : "items-start")}
          >
            <div className={"flex max-w-[88%] gap-2 " + (m.role === "user" ? "flex-row-reverse" : "")}>
              {m.role === "assistant" && (
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-50 text-sm">
                  🌊
                </span>
              )}
              <div
                className={
                  "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed " +
                  (m.role === "user"
                    ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white"
                    : "border border-slate-200 bg-white text-slate-800")
                }
              >
                {m.content}
              </div>
            </div>

            {m.steps && m.steps.length > 0 && (
              <details className="ml-9 w-full max-w-[88%] rounded-xl border border-slate-200 bg-slate-50/70">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-500">
                  🔍 How the AI worked it out · {m.steps.length}{" "}
                  {m.steps.length === 1 ? "step" : "steps"}
                </summary>
                <div className="space-y-3 border-t border-slate-200/70 p-3">
                  {m.steps.map((s, j) => (
                    <div key={j} className="flex gap-3">
                      {s.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.thumbnail}
                          alt={s.label}
                          className="h-20 w-20 flex-none rounded-lg border border-slate-200 bg-white object-contain"
                        />
                      ) : (
                        <div
                          className={
                            "flex h-20 w-20 flex-none items-center justify-center rounded-lg border text-2xl " +
                            (s.kind === "web"
                              ? "border-sky-200 bg-sky-50"
                              : "border-emerald-200 bg-emerald-50")
                          }
                        >
                          {s.kind === "web" ? "🌐" : "🌍"}
                        </div>
                      )}
                      <div className="min-w-0 flex-1 text-xs text-slate-600">
                        <p className="font-medium text-slate-700">{s.label}</p>
                        <p className="italic text-slate-400">“{s.query}”</p>
                        <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{s.finding}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {m.report && (
              <div className="ml-9 w-full max-w-[88%] rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-medium text-emerald-900">📄 {m.report.title}</p>
                <p className="text-xs text-emerald-700/70">Report ready to download</p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={`/api/reports/${m.report.id}?format=docx`}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    ⬇ Word
                  </a>
                  <a
                    href={`/api/reports/${m.report.id}?format=pdf`}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    ⬇ PDF
                  </a>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-slate-400">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-50 text-sm">
              🌊
            </span>
            <span className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-brand-400" />
            </span>
          </div>
        )}
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-slate-100 p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Ask about your maps…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex-none rounded-xl px-3.5 py-2"
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      </form>
    </div>
  );
}
