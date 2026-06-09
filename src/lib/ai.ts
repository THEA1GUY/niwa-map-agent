import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { cropRegion, REGIONS, thumbnailDataUrl, type Region } from "./image";
import { findWaterways, lookupPlace } from "./osm";
import { webSearch } from "./tavily";

/**
 * Agentic, multi-map analysis. The reasoning model (gpt-oss-120b) drives and may
 * call tools: ask_vision / zoom_in (Groq Llama 4 Scout, on any of the chat's
 * maps), lookup_place / find_waterways (OpenStreetMap), and create_report.
 *
 * Reasoning defaults to Groq (fast, fits serverless time limits). Set
 * REASONING_PROVIDER=openrouter to switch.
 */

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME ?? "NIWA Map Agent",
  },
});

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: "https://api.deepseek.com",
});

const PROVIDER = process.env.REASONING_PROVIDER ?? "groq";
const reasoningClient =
  PROVIDER === "openrouter" ? openrouter : PROVIDER === "deepseek" ? deepseek : groq;

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
const REASONING_MODEL =
  PROVIDER === "deepseek"
    ? (process.env.DEEPSEEK_MODEL ?? "deepseek-chat")
    : (process.env.OPENROUTER_REASONING_MODEL ?? "openai/gpt-oss-120b");

const MAX_TOOL_ROUNDS = 4;
const REPORT_TOOL_ROUNDS = 2; // report requests gather briefly, then we force the report call

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(err: unknown): number {
  const e = err as { headers?: { get?: (k: string) => string | null }; message?: string };
  const header = Number(e?.headers?.get?.("retry-after"));
  if (header > 0) return Math.min(header, 15) * 1000;
  const m = /try again in ([\d.]+)s/i.exec(e?.message ?? "");
  if (m) return Math.min(parseFloat(m[1]), 15) * 1000 + 400;
  return 8000;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < tries - 1) {
        await sleep(retryDelayMs(err));
        continue;
      }
      throw err;
    }
  }
}

const PLAIN_TEXT_RULE = `Write for a general reader who may not understand markdown. Use plain text only:
- Do NOT use markdown. No asterisks for bold, no "#" headings, no "|" tables, no backticks.
- For a heading, write it as plain words on its own line ending with a colon, e.g. "Rivers shown:".
- For a list, start each line with "- " (a hyphen and a space).
- Keep paragraphs short and clear.`;

const NO_GUESSING = `Accuracy is critical. Report ONLY what is clearly legible.
- Transcribe exact text, names, numbers and table values that you can actually read.
- If something is too small, blurry, or cut off to read with confidence, say it is "not clearly legible" — do NOT guess or invent place names, river names, numbers, or distances.
- It is better to say you cannot read something than to make it up.`;

const PERSONA = `You are a research assistant for the National Inland Waterways Authority (NIWA) of Nigeria.
You help researchers interpret maps, hydrographic charts, bathymetric surveys, and waterway documents.
Clearly separate what is OBSERVED from what is INFERRED.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type MapInput = { name: string; buffer: Buffer };

export type Step = {
  kind: "vision" | "osm" | "web";
  label: string;
  query: string;
  thumbnail?: string;
  finding: string;
};

/** One vision call against a (possibly cropped + magnified) region, returning answer + crop. */
async function cropAndAsk(
  imageBuffer: Buffer,
  region: Region,
  question: string,
): Promise<{ finding: string; crop: Buffer }> {
  const crop = await cropRegion(imageBuffer, region);
  const dataUrl = `data:image/png;base64,${crop.toString("base64")}`;
  const res = await withRetry(() =>
    groq.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            "You are an expert at reading maps and charts. Read the image carefully and answer the question. " +
            NO_GUESSING +
            " " +
            PLAIN_TEXT_RULE,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                (region === "full"
                  ? "This is the full map. "
                  : `This is a magnified view of the "${region}" region of the map. `) + question,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  );
  return { finding: res.choices[0]?.message?.content ?? "", crop };
}

/** Public single-image vision helper (used to generate the first-pass overview). */
export async function vision(
  imageBuffer: Buffer,
  region: Region,
  question: string,
): Promise<string> {
  return (await cropAndAsk(imageBuffer, region, question)).finding;
}

const reportTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_report",
    description:
      "Generate a downloadable Word/PDF report for the user. Call this ONLY when the user asks for a " +
      "report, summary document, briefing, or write-up. Gather details with the other tools first, then " +
      "call create_report with a clear title and the COMPLETE report text. The map images are added automatically.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short report title." },
        body: {
          type: "string",
          description:
            "The full report content as plain text (no markdown). Use headings like 'Findings:' on their " +
            "own line and '- ' for list items.",
        },
      },
      required: ["title", "body"],
    },
  },
};

function visionTools(mapCount: number): ChatCompletionTool[] {
  const mapProp =
    mapCount > 1
      ? {
          map: {
            type: "integer" as const,
            description: `Which map to look at, 1 to ${mapCount}.`,
          },
        }
      : {};
  const mapReq = mapCount > 1 ? ["map"] : [];
  return [
    {
      type: "function",
      function: {
        name: "ask_vision",
        description:
          "Look at the WHOLE of a map to understand its layout (title, legend, tables, regions).",
        parameters: {
          type: "object",
          properties: { ...mapProp, question: { type: "string", description: "What to look for." } },
          required: [...mapReq, "question"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "zoom_in",
        description:
          "Zoom into one region of a map at high magnification to READ SMALL TEXT accurately. " +
          `Valid regions: ${REGIONS.filter((r) => r !== "full").join(", ")}.`,
        parameters: {
          type: "object",
          properties: {
            ...mapProp,
            region: {
              type: "string",
              enum: REGIONS.filter((r) => r !== "full"),
              description: "Which part of the map to magnify.",
            },
            question: { type: "string", description: "What to read in that region." },
          },
          required: [...mapReq, "region", "question"],
        },
      },
    },
  ];
}

const osmTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "lookup_place",
      description:
        "Check OpenStreetMap whether a place/feature (river, town, dam, lake) exists and get its real " +
        "coordinates. Use to VERIFY a name you read and catch misreads.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Name to look up, e.g. 'Gurara River, Nigeria'." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_waterways",
      description:
        "Get the real rivers, lakes and dams OpenStreetMap records in/around an area. Use to confirm the " +
        "map's waterways and find ones it may have missed.",
      parameters: {
        type: "object",
        properties: { area: { type: "string", description: "An area name, e.g. 'Abuja, Nigeria'." } },
        required: ["area"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web (with sources) for factual background not on the map: river lengths, dam " +
        "capacities, navigation depths, hydrology, history, or recent news. Use when the user wants " +
        "facts beyond what the map and OpenStreetMap show.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for." } },
        required: ["query"],
      },
    },
  },
];

/** Agentic answer across one or more maps. */
export async function answerAboutMap(opts: {
  question: string;
  maps?: MapInput[]; // image maps in the chat → enables the vision tools
  overview?: string;
  textContext?: string;
  history: ChatTurn[];
  onCreateReport?: (args: { title: string; body: string }) => Promise<{ id: string } | null>;
  forceReport?: boolean;
}): Promise<{ answer: string; steps: Step[]; report?: { id: string; title: string } }> {
  const maps = opts.maps ?? [];
  const hasVision = maps.length > 0;
  const steps: Step[] = [];
  let report: { id: string; title: string } | undefined;

  const activeTools = [
    ...(hasVision ? visionTools(maps.length) : []),
    ...osmTools,
    ...(opts.onCreateReport ? [reportTool] : []),
  ];

  const finalize = async (content: string) => {
    if (opts.forceReport && !report && opts.onCreateReport) {
      // Force the model to call create_report (don't rely on it choosing to).
      try {
        const forced = await withRetry(() =>
          reasoningClient.chat.completions.create({
            model: REASONING_MODEL,
            temperature: 0,
            max_tokens: 1500,
            messages: [
              ...messages,
              {
                role: "user",
                content:
                  "Produce the report now by CALLING the create_report tool with a clear title and the " +
                  "COMPLETE report body in plain text (based on everything gathered). Do not answer with text — call the tool.",
              },
            ],
            tools: [reportTool],
            tool_choice: { type: "function", function: { name: "create_report" } },
          }),
        );
        const call = forced.choices[0]?.message?.tool_calls?.find(
          (c) => c.type === "function" && c.function.name === "create_report",
        );
        if (call && call.type === "function") {
          const args = JSON.parse(call.function.arguments || "{}");
          const title = String(args.title ?? "NIWA Map Report");
          const body = String(args.body ?? content);
          const created = await opts.onCreateReport({ title, body });
          if (created) {
            report = { id: created.id, title };
            return {
              answer: content || `Your report "${title}" is ready to download below.`,
              steps,
              report,
            };
          }
        }
      } catch {
        /* fall through to text fallback */
      }
      // Fallback: turn the text answer into a report.
      if (!report && content.trim().length > 40) {
        const first = content.split("\n").map((s) => s.trim()).find(Boolean) || "NIWA Map Report";
        const title = (first.replace(/[:–—-].*$/, "").trim() || "NIWA Map Report").slice(0, 80);
        const created = await opts.onCreateReport({ title, body: content });
        if (created) report = { id: created.id, title };
      }
    }
    return { answer: content, steps, report };
  };

  const mapList = maps.map((m, i) => `${i + 1}) ${m.name}`).join("; ");

  const contextParts: string[] = [];
  if (opts.overview) contextParts.push(`INITIAL OVERVIEW:\n${opts.overview}`);
  if (opts.textContext) contextParts.push(`EXTRACTED FILE CONTENT:\n${opts.textContext}`);
  const context = contextParts.join("\n\n");

  const systemContent =
    PERSONA +
    "\n\n" +
    (hasVision
      ? `This chat includes ${maps.length} map${maps.length > 1 ? "s" : ""}: ${mapList}.\n` +
        "You cannot see them directly, but you have vision tools:\n" +
        "- ask_vision: view a WHOLE map.\n- zoom_in: magnify ONE region of a map to read small text.\n" +
        (maps.length > 1 ? "Pass the map number (1-based) to choose which map. " : "") +
        "Use ask_vision for layout then zoom_in to read detail. Treat results as your eyes; never say no image was provided.\n\n"
      : "") +
    "You also have research tools:\n" +
    "- lookup_place: confirm a river/town/dam exists in OpenStreetMap and get its REAL COORDINATES.\n" +
    "- find_waterways: list the real rivers/lakes/dams in an area from OpenStreetMap.\n" +
    "- web_search: get sourced facts from the web (river lengths, dam capacities, hydrology, history).\n" +
    "ALWAYS verify the main places you mention using lookup_place, and INCLUDE their real coordinates " +
    "(latitude, longitude) in your answer. When the map and OpenStreetMap agree, say so; when a name is not " +
    "found, flag it as a possible misread. Use web_search when the user wants facts beyond the map. " +
    "Cite your sources (OpenStreetMap / web).\n\n" +
    (opts.onCreateReport
      ? "When the user asks for a REPORT, briefing or write-up, gather what you need then call create_report.\n\n"
      : "") +
    NO_GUESSING +
    "\nOnly state facts the tools confirmed. If something could not be read, say so.\n\n" +
    (context ? "---\n" + context + "\n---\n\n" : "") +
    PLAIN_TEXT_RULE;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...opts.history,
    { role: "user", content: opts.question },
  ];

  const pickMap = (idx: unknown): number => {
    const n = Number(idx);
    return Number.isFinite(n) && n >= 1 && n <= maps.length ? Math.floor(n) - 1 : 0;
  };
  const mapTag = (i: number) => (maps.length > 1 ? `${maps[i].name} · ` : "");

  const maxRounds = opts.forceReport ? REPORT_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
  for (let round = 0; round < maxRounds; round++) {
    const res = await withRetry(() =>
      reasoningClient.chat.completions.create({
        model: REASONING_MODEL,
        temperature: 0,
        max_tokens: 1200,
        messages,
        tools: activeTools.length ? activeTools : undefined,
        tool_choice: activeTools.length ? "auto" : undefined,
      }),
    );

    const msg = res.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) return await finalize(msg.content ?? "");

    messages.push(msg);
    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let result = "";
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const name = call.function.name;
        if (name === "lookup_place") {
          const query = String(args.query ?? "");
          result = await lookupPlace(query);
          steps.push({ kind: "osm", label: "OpenStreetMap — place check", query, finding: result });
        } else if (name === "find_waterways") {
          const area = String(args.area ?? "");
          result = await findWaterways(area);
          steps.push({ kind: "osm", label: "OpenStreetMap — waterways", query: area, finding: result });
        } else if (name === "web_search") {
          const query = String(args.query ?? "");
          result = await webSearch(query);
          steps.push({ kind: "web", label: "Web search", query, finding: result });
        } else if (name === "create_report") {
          if (opts.onCreateReport) {
            const title = String(args.title ?? "NIWA Map Report");
            const body = String(args.body ?? "");
            const created = await opts.onCreateReport({ title, body });
            if (created) {
              report = { id: created.id, title };
              result = `Report "${title}" created and ready to download.`;
            } else {
              result = "Report generation failed.";
            }
          } else {
            result = "Report tool is not available.";
          }
        } else if (hasVision) {
          const i = pickMap(args.map);
          const q = typeof args.question === "string" ? args.question : opts.question;
          const region: Region =
            name === "zoom_in" && (REGIONS as string[]).includes(args.region)
              ? (args.region as Region)
              : name === "zoom_in"
                ? "center"
                : "full";
          const { finding, crop } = await cropAndAsk(maps[i].buffer, region, q);
          result = finding;
          steps.push({
            kind: "vision",
            label: `${mapTag(i)}${region === "full" ? "Whole map" : `Zoom: ${region}`}`,
            query: q,
            thumbnail: await thumbnailDataUrl(crop),
            finding,
          });
        } else {
          result = "No image available.";
        }
      } catch {
        result = "Tool lookup failed.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  const finalRes = await withRetry(() =>
    reasoningClient.chat.completions.create({
      model: REASONING_MODEL,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Give your best complete answer now, using only what the tools confirmed. " +
            "Clearly note anything that could not be read. " +
            PLAIN_TEXT_RULE,
        },
      ],
    }),
  );
  return await finalize(finalRes.choices[0]?.message?.content ?? "");
}
