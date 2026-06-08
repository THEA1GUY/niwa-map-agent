"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export default function UploadForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const files = form.getAll("file").filter((f) => f instanceof File && f.size > 0);
    if (files.length === 0) {
      setError("Choose one or more files to upload.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/maps", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Upload failed. Please try again.");
        return;
      }
      formRef.current?.reset();
      setNames([]);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="panel p-2">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-6 py-7 text-center sm:flex-row sm:text-left">
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-brand-50 text-2xl">
          ⬆️
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-800">Upload maps</p>
          <p className="text-xs text-slate-500">
            Images, photos, charts or PDFs · up to 15&nbsp;MB each · you can pick several
          </p>
          <label className="mt-2 inline-block cursor-pointer text-sm font-medium text-brand-700 hover:underline">
            Choose files
            <input
              name="file"
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) =>
                setNames(Array.from(e.currentTarget.files ?? []).map((f) => f.name))
              }
            />
          </label>
          {names.length > 0 && (
            <p className="mt-1 truncate text-xs text-slate-500">
              {names.length} file{names.length === 1 ? "" : "s"}: {names.join(", ")}
            </p>
          )}
        </div>
        <button type="submit" disabled={loading} className="btn-primary flex-none">
          {loading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <p className="px-2 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}
