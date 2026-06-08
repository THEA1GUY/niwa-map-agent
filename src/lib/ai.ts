import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

/**
 * Two AI engines (both speak the OpenAI-style API):
 *  - Groq runs the VISION model (Llama 4 Scout) that "looks" at the map image.
 *  - The REASONING model (gpt-oss-120b) drives the conversation and can call the
 *    vision model as a TOOL — asking it specific follow-up questions about the
 *    image until it has enough to answer the user. This is the agentic loop.
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

const MAX_TOOL_ROUNDS = 4;

// Plain-text rule applied to every model so end users never see raw markdown.
const PLAIN_TEXT_RULE = `Write for a general reader who may not understand markdown. Use plain text only:
- Do NOT use markdown. No asterisks for bold, no "#" headings, no "|" tables, no backticks.
- For a heading, write it as plain words on its own line ending with a colon, e.g. "Rivers shown:".
- For a list, start each line with "- " (a hyphen and a space).
- Keep paragraphs short and clear.`;

const PERSONA = `You are a research assistant for the National Inland Waterways Authority (NIWA) of Nigeria.
You help researchers interpret maps, hydrographic charts, bathymetric surveys, and waterway documents.
Be precise. Clearly separate what is OBSERVED on the map from what is INFERRED. If something cannot be
determined from the material, say so plainly rather than guessing.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Vision call: answer a SPECIFIC question about the image. Used as the agent's tool. */
export async function analyzeImage(
  base64DataUrl: string,
  question: string,
): Promise<string> {
  const res = await groq.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You are an expert cartographic and hydrographic image analyst. Look at the image and answer the question factually and specifically, reading any visible text, labels, legends, tables, and values. " +
          PLAIN_TEXT_RULE,
      },
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: base64DataUrl } },
        ],
      },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

const visionTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "ask_vision",
    description:
      "Look at the uploaded map image and get an answer to a specific visual question " +
      "(e.g. 'read the legend', 'read every row of the table on the right', 'list the rivers " +
      "labelled near Abuja', 'what is the scale bar value'). Call this as many times as needed " +
      "to gather details before answering the user.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "A specific question about what is visible in the map image.",
        },
      },
      required: ["question"],
    },
  },
};

/**
 * Agentic answer: the reasoning model answers the user's question, and may call the
 * vision model (ask_vision) repeatedly to inspect the image until it can answer.
 */
export async function answerAboutMap(opts: {
  question: string;
  imageDataUrl?: string; // present for image maps → enables the ask_vision tool
  overview?: string; // a cached first-pass description of the image
  textContext?: string; // for non-image files (PDF/data)
  history: ChatTurn[];
}): Promise<string> {
  const contextParts: string[] = [];
  if (opts.overview)
    contextParts.push(`INITIAL OVERVIEW OF THE UPLOADED MAP:\n${opts.overview}`);
  if (opts.textContext)
    contextParts.push(`EXTRACTED FILE CONTENT:\n${opts.textContext}`);
  const context = contextParts.join("\n\n");

  const hasVision = Boolean(opts.imageDataUrl);

  const systemContent =
    PERSONA +
    "\n\n" +
    (hasVision
      ? "A map IMAGE has been uploaded. You cannot see it directly, but you have a tool called " +
        "ask_vision that inspects the image and answers specific questions about it. When the user " +
        "asks about the map, call ask_vision as many times as needed (read the legend, tables, " +
        "labels, specific regions) until you have enough detail, then give a complete answer. " +
        "Treat ask_vision's replies as a faithful first-hand view of the map. Never tell the user " +
        "that no image was provided.\n\n"
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
      temperature: 0.3,
      max_tokens: 1500,
      messages,
      tools: hasVision ? [visionTool] : undefined,
      tool_choice: hasVision ? "auto" : undefined,
    });

    const msg = res.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return msg.content ?? "";
    }

    // Run each requested vision lookup and feed the results back.
    messages.push(msg);
    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let result = "";
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const q = typeof args.question === "string" ? args.question : opts.question;
        result = opts.imageDataUrl ? await analyzeImage(opts.imageDataUrl, q) : "No image available.";
      } catch {
        result = "Vision lookup failed.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // Ran out of tool rounds — force a final answer with what we have.
  const finalRes = await reasoningClient.chat.completions.create({
    model: REASONING_MODEL,
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "Based on everything gathered so far, give your best complete answer to my question now. " +
          PLAIN_TEXT_RULE,
      },
    ],
  });
  return finalRes.choices[0]?.message?.content ?? "";
}
