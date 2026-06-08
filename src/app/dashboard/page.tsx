import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import UploadForm from "@/components/UploadForm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maps } from "@/lib/schema";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await db
    .select()
    .from(maps)
    .where(eq(maps.userId, user.id))
    .orderBy(desc(maps.createdAt));

  return (
    <>
      <Header userName={user.name} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Your maps</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a map, then chat with the assistant and generate a report.
        </p>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
          <section>
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
                No maps yet. Upload your first one to get started. →
              </div>
            ) : (
              <ul className="space-y-3">
                {rows.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/maps/${m.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-sky-300 hover:bg-sky-50/40"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{m.title}</p>
                        <p className="text-xs text-slate-500">
                          {m.fileName} ·{" "}
                          {new Date(m.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        {m.kind}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside>
            <UploadForm />
          </aside>
        </div>
      </main>
    </>
  );
}
