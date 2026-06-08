"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export default function UploadForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <input
        name="file"
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="min-w-0 flex-1 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sky-700 hover:file:bg-sky-100"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
      >
        {loading ? "Uploading…" : "Upload maps"}
      </button>
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </form>
  );
}
