import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { cropRegion, REGIONS, type Region } from "./image";

/**
 * Agentic map analysis:
 *  - Groq runs the VISION model (Llama 4 Scout) that reads the image.
 *  - The REASONING model (gpt-oss-120b) drives, and can call the vision model as
 *    tools: ask_vision (whole map, for layout) and zoom_in (a magnified region,
 *    for reading small text accurately). It keeps querying until it can answer.
 *
 * Reasoning defaults to Groq (fast). Set REASONING_PROVIDER=openrouter to switch.
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

const useOpenRouter = (process.env.REASONING_PROVIDER ?? "groq") === "openrouter";
const reasoningClient = useOpenRouter ? openrouter : groq;

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
const REASONING_MODEL =
  process.env.OPENROUTER_REASONING_MODEL ?? "openai/gpt-oss-120b";

const MAX_TOOL_ROUNDS = 6;

const PLAIN_TEXT_RULE = `Write for a general reader who may not understand markdown. Use plain text only:
- Do NOT use markdown. No asterisks for bold, no "#" headings, no "|" tables, no backticks.
- For a heading, write it as plain words on its own line ending with a colon, e.g. "Rivers shown:".
- For a list, start each line with "- " (a hyphen and a space).
- Keep paragraphs short and clear.`;

// Accuracy rule shared by every model call.
const NO_GUESSING = `Accuracy is critical. Report ONLY what is clearly legible.
- Transcribe exact text, names, numbers and table values that you can actually read.
- If something is too small, blurry, or cut off to read with confidence, say it is "not clearly legible" — do NOT guess or invent place names, river names, numbers, or distances.
- It is better to say you cannot read something than to make it up.`;

const PERSONA = `You are a research assistant for the National Inland Waterways Authority (NIWA) of Nigeria.
You help researchers interpret maps, hydrographic charts, bathymetric surveys, and waterway documents.
Clearly separate what is OBSERVED from what is INFERRED.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** One vision call against a (possibly cropped + magnified) region of the image. */
export async function vision(
  imageBuffer: Buffer,
  region: Region,
  question: string,
): Promise<string> {
  const cropped = await cropRegion(imageBuffer, region);
  const dataUrl = `data:image/png;base64,${cropped.toString("base64")}`;
  const res = await groq.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0,
    max_tokens: 1000,
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
  });
  return res.choices[0]?.message?.content ?? "";
}

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "ask_vision",
      description:
        "Look at the WHOLE map to understand its overall layout and where things are " +
        "(title, legend, tables, regions). Good for orientation, but small text may be hard to read here.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "What to look for on the whole map." },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "zoom_in",
      description:
        "Zoom into one region of the map at high magnification to READ SMALL TEXT accurately " +
        "(legends, tables, dense labels, numbers). Always prefer this for reading detail. " +
        `Valid regions: ${REGIONS.filter((r) => r !== "full").join(", ")}.`,
      parameters: {
        type: "object",
        properties: {
          region: {
            type: "string",
            enum: REGIONS.filter((r) => r !== "full"),
            description: "Which part of the map to magnify.",
          },
          question: {
            type: "string",
            description: "What to read or look for in that region.",
          },
        },
        required: ["region", "question"],
      },
    },
  },
];

/**
 * Agentic answer: the reasoning model answers the user's question and may call the
 * vision tools (ask_vision / zoom_in) repeatedly until it has read enough detail.
 */
export async function answerAboutMap(opts: {
  question: string;
  imageBuffer?: Buffer; // present for image maps → enables the vision tools
  overview?: string; // cached first-pass description of the map
  textContext?: string; // for non-image files (PDF/data)
  history: ChatTurn[];
}): Promise<string> {
  const hasVision = Boolean(opts.imageBuffer);

  const contextParts: string[] = [];
  if (opts.overview)
    contextParts.push(`INITIAL OVERVIEW OF THE MAP (verify details with the tools):\n${opts.overview}`);
  if (opts.textContext) contextParts.push(`EXTRACTED FILE CONTENT:\n${opts.textContext}`);
  const context = contextParts.join("\n\n");

  const systemContent =
    PERSONA +
    "\n\n" +
    (hasVision
      ? "A map IMAGE has been uploaded. You cannot see it directly, but you have two tools:\n" +
        "- ask_vision: view the WHOLE map (use first, to learn the layout).\n" +
        "- zoom_in: magnify ONE region to read small text accurately (use this to read legends, tables, and dense labels).\n" +
        "Plan: first use ask_vision to find where things are, then zoom_in on the relevant regions to read the exact details before answering. " +
        "Call the tools as many times as needed. Treat their replies as your eyes; never say no image was provided.\n\n" +
        NO_GUESSING +
        "\nOnly state facts the tools actually confirmed. If a detail could not be read clearly, tell the user it was not legible and suggest uploading a higher-resolution image.\n\n"
      : "") +
    (context ? "---\n" + context + "\n---\n\n" : "") +
    PLAIN_TEXT_RULE;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...opts.history,
    { role: "user", content: opts.question },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await reasoningClient.chat.completions.create({
      model: REASONING_MODEL,
      temperature: 0,
      max_tokens: 1500,
      messages,
      tools: hasVision ? tools : undefined,
      tool_choice: hasVision ? "auto" : undefined,
    });

    const msg = res.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return msg.content ?? "";
    }

    messages.push(msg);
    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let result = "";
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const q = typeof args.question === "string" ? args.question : opts.question;
        if (!opts.imageBuffer) {
          result = "No image available.";
        } else if (call.function.name === "zoom_in") {
          const region = (REGIONS as string[]).includes(args.region)
            ? (args.region as Region)
            : "center";
          result = await vision(opts.imageBuffer, region, q);
        } else {
          result = await vision(opts.imageBuffer, "full", q);
        }
      } catch {
        result = "Vision lookup failed.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // Out of tool rounds — force a final answer with what was gathered.
  const finalRes = await reasoningClient.chat.completions.create({
    model: REASONING_MODEL,
    temperature: 0,
    max_tokens: 1500,
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
  });
  return finalRes.choices[0]?.message?.content ?? "";
}
