"use client";

import { useRef, useState } from "react";

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
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            Ask anything about this map — e.g. “Summarise this survey” or “Where are the
            shallow areas?”
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              "flex flex-col " + (m.role === "user" ? "items-end" : "items-start")
            }
          >
            <div
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                (m.role === "user"
                  ? "bg-sky-700 text-white"
                  : "bg-slate-100 text-slate-800")
              }
            >
              {m.content}
            </div>

            {m.steps && m.steps.length > 0 && (
              <details open className="mt-2 w-full max-w-[85%] rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">
                  🔍 How the AI worked it out ({m.steps.length}{" "}
                  {m.steps.length === 1 ? "step" : "steps"})
                </summary>
                <div className="space-y-3 border-t border-slate-100 p-3">
                  {m.steps.map((s, j) => (
                    <div key={j} className="flex gap-3">
                      {s.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.thumbnail}
                          alt={s.label}
                          className="h-24 w-24 flex-none rounded border border-slate-200 bg-slate-50 object-contain"
                        />
                      ) : (
                        <div className="flex h-24 w-24 flex-none items-center justify-center rounded border border-slate-200 bg-emerald-50 text-3xl">
                          {s.kind === "web" ? "🌐" : "🌍"}
                        </div>
                      )}
                      <div className="min-w-0 text-xs text-slate-600">
                        <p className="font-medium text-slate-700">{s.label}</p>
                        <p className="italic text-slate-400">“{s.query}”</p>
                        <p className="mt-1 whitespace-pre-wrap">{s.finding}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {m.report && (
              <div className="mt-2 w-full max-w-[85%] rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-medium text-emerald-900">
                  📄 Report ready: {m.report.title}
                </p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={`/api/reports/${m.report.id}?format=docx`}
                    className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    ⬇ Word
                  </a>
                  <a
                    href={`/api/reports/${m.report.id}?format=pdf`}
                    className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    ⬇ PDF
                  </a>
                </div>
              </div>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-slate-400">Thinking…</p>}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>

      <form onSubmit={send} className="border-t border-slate-200 p-3">
        <textarea
          ref={inputRef}
          rows={2}
          placeholder="Ask a question about this map…"
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
