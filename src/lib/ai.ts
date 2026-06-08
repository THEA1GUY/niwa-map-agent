import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Two AI engines (both speak the OpenAI-style API, so the same SDK talks to both):
 *  - Groq runs the VISION model (Llama 4 Scout) that "looks" at map images.
 *  - OpenRouter runs the REASONING model (gpt-oss-120b) that writes the answers.
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

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
const REASONING_MODEL =
  process.env.OPENROUTER_REASONING_MODEL ?? "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are a specialised research assistant for the National Inland Waterways Authority (NIWA) of Nigeria.
You help researchers interpret maps, nautical/hydrographic charts, bathymetric surveys, and waterway documents.
Be precise and professional. Clearly separate what is directly OBSERVED in the source from what is INFERRED.
When information is not supported by the provided material, say so plainly rather than guessing.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Step 1 — Groq vision: produce a detailed factual analysis of a map image. */
export async function analyzeImage(
  base64DataUrl: string,
  focus: string,
): Promise<string> {
  const res = await groq.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are an expert cartographic and hydrographic image analyst. Describe the image precisely and factually.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyse this map/scan in detail to help with: "${focus}". List every relevant feature you can see: title, scale, legend, north arrow, water bodies, channels, depth/soundings, contour or elevation values, place names, labels, coordinates, grid lines, and anything notable. Be specific.`,
          },
          { type: "image_url", image_url: { url: base64DataUrl } },
        ],
      },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

/** Step 2 — OpenRouter reasoning: answer the user's question using the gathered context. */
export async function reason(opts: {
  question: string;
  imageAnalysis?: string;
  textContext?: string;
  history: ChatTurn[];
}): Promise<string> {
  const parts: string[] = [];
  if (opts.imageAnalysis)
    parts.push(`VISION ANALYSIS OF THE UPLOADED MAP:\n${opts.imageAnalysis}`);
  if (opts.textContext)
    parts.push(`EXTRACTED DOCUMENT / DATA CONTENT:\n${opts.textContext}`);
  const context = parts.join("\n\n") || "No additional extracted context is available.";

  // Everything goes in ONE system message. Critically, we tell the model the
  // vision analysis IS its eyes — otherwise it replies "no image was provided".
  const systemContent =
    SYSTEM_PROMPT +
    "\n\nThe user has uploaded a map/document. You cannot open the raw file, but " +
    "the material below was produced from it (a vision model described the image, " +
    "and/or text was extracted). Treat it as a faithful, first-hand view of the " +
    "uploaded item and answer confidently as if you can see it. Never tell the user " +
    "the image was not provided.\n\n" +
    "---\n" +
    context +
    "\n---";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...opts.history,
    { role: "user", content: opts.question },
  ];

  const res = await openrouter.chat.completions.create({
    model: REASONING_MODEL,
    temperature: 0.3,
    messages,
  });
  return res.choices[0]?.message?.content ?? "";
}
