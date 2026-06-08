"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UploadForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Please choose a file to upload.");
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
      router.push(`/maps/${data.id}`);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <h2 className="font-medium text-slate-900">Upload a new map</h2>
      <p className="mt-1 text-sm text-slate-500">
        Scanned maps, photos, charts, or PDFs. Up to 15&nbsp;MB.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Title</span>
          <input
            name="title"
            type="text"
            placeholder="e.g. River Niger — Lokoja channel survey"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">File</span>
          <input
            name="file"
            type="file"
            accept="image/*,application/pdf"
            className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sky-700 hover:file:bg-sky-100"
          />
        </label>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
        >
          {loading ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}
