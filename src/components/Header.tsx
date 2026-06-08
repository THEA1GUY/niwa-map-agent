"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Header({ userName }: { userName: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-lg">🌊</span>
          <span className="font-semibold text-slate-900">NIWA Map Agent</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="hidden text-slate-500 sm:inline">{userName}</span>
          <button
            onClick={logout}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
