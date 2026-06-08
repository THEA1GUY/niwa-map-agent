"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="panel overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-7 py-7 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-xl backdrop-blur">
              🌊
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">NIWA Map Agent</p>
              <p className="text-xs text-white/70">National Inland Waterways Authority</p>
            </div>
          </div>
          <h1 className="mt-5 text-2xl font-semibold">
            {isRegister ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-white/80">
            {isRegister
              ? "Set up access to analyse maps with AI."
              : "Sign in to analyse maps with AI."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-7 py-7">
          {isRegister && (
            <Field label="Full name" name="name" type="text" autoComplete="name" placeholder="Jane Doe" />
          )}
          <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@niwa.gov.ng" />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder="••••••••"
            hint={isRegister ? "At least 8 characters" : undefined}
          />

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>

          <p className="text-center text-sm text-slate-500">
            {isRegister ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-brand-700 hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href="/register" className="font-semibold text-brand-700 hover:underline">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  hint,
  placeholder,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="field"
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
