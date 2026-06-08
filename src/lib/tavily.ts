/** Tavily web search — gives the agent sourced factual background. */

export async function webSearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "Web search is not configured (no Tavily API key).";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 5,
        include_answer: true,
        search_depth: "basic",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return `Web search failed (status ${res.status}).`;
    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{ title?: string; content?: string; url?: string }>;
    };
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of (data.results ?? []).slice(0, 5)) {
      parts.push(`- ${r.title ?? "source"}: ${(r.content ?? "").slice(0, 220)} [${r.url ?? ""}]`);
    }
    return parts.join("\n") || "No web results found.";
  } catch {
    return "Web search failed (network/timeout).";
  } finally {
    clearTimeout(timer);
  }
}
