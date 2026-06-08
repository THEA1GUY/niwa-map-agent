import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { cropRegion, REGIONS, thumbnailDataUrl, type Region } from "./image";
import { findWaterways, lookupPlace } from "./osm";

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

/** A record of one thing the agent did to find the answer, surfaced to the user. */
export type Step = {
  kind: "vision" | "osm";
  label: string; // e.g. "Whole map", "Zoom: center", "OpenStreetMap"
  query: string;
  thumbnail?: string; // small JPEG data URL — vision crops only
  finding: string;
};

/** Crop+magnify a region, ask the vision model about it, and return both the answer and the crop. */
async function cropAndAsk(
  imageBuffer: Buffer,
  region: Region,
  question: string,
): Promise<{ finding: string; crop: Buffer }> {
  const crop = await cropRegion(imageBuffer, region);
  const dataUrl = `data:image/png;base64,${crop.toString("base64")}`;
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
  return { finding: res.choices[0]?.message?.content ?? "", crop };
}

/** One vision call against a (possibly cropped + magnified) region of the image. */
export async function vision(
  imageBuffer: Buffer,
  region: Region,
  question: string,
): Promise<string> {
  return (await cropAndAsk(imageBuffer, region, question)).finding;
}

const visionTools: ChatCompletionTool[] = [
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

// OpenStreetMap tools — always available, for verifying and enriching with real geography.
const osmTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "lookup_place",
      description:
        "Check OpenStreetMap for whether a place or feature (a river, town, dam, lake) really exists, " +
        "and get its real coordinates. Use this to VERIFY a name you read on the map and to catch misreads.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The place/feature name to look up, e.g. 'Gurara River, Nigeria'.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_waterways",
      description:
        "Get the real rivers, lakes and dams that OpenStreetMap records in/around a named area. " +
        "Use this to confirm the waterways on the map and to find ones the map may have missed.",
      parameters: {
        type: "object",
        properties: {
          area: {
            type: "string",
            description: "An area or place name, e.g. 'Abuja, Nigeria' or 'Lokoja'.",
          },
        },
        required: ["area"],
      },
    },
  },
];

/**
 * Agentic answer: the reasoning model answers the user's question and may call the
 * vision tools (ask_vision / zoom_in) and OpenStreetMap tools (lookup_place /
 * find_waterways) repeatedly until it has gathered and verified enough detail.
 */
export async function answerAboutMap(opts: {
  question: string;
  imageBuffer?: Buffer; // present for image maps → enables the vision tools
  overview?: string; // cached first-pass description of the map
  textContext?: string; // for non-image files (PDF/data)
  history: ChatTurn[];
}): Promise<{ answer: string; steps: Step[] }> {
  const hasVision = Boolean(opts.imageBuffer);
  const steps: Step[] = [];
  const activeTools = [...(hasVision ? visionTools : []), ...osmTools];

  const contextParts: string[] = [];
  if (opts.overview)
    contextParts.push(`INITIAL OVERVIEW OF THE MAP (verify details with the tools):\n${opts.overview}`);
  if (opts.textContext) contextParts.push(`EXTRACTED FILE CONTENT:\n${opts.textContext}`);
  const context = contextParts.join("\n\n");

  const systemContent =
    PERSONA +
    "\n\n" +
    (hasVision
      ? "A map IMAGE has been uploaded. You cannot see it directly, but you have vision tools:\n" +
        "- ask_vision: view the WHOLE map (use first, to learn the layout).\n" +
        "- zoom_in: magnify ONE region to read small text accurately (legends, tables, dense labels).\n" +
        "Plan: use ask_vision for layout, then zoom_in on the relevant regions to read exact details. " +
        "Treat their replies as your eyes; never say no image was provided.\n\n"
      : "") +
    "You also have OpenStreetMap tools (real-world geographic data):\n" +
    "- lookup_place: confirm a name you read (river, town, dam) actually exists and get its real coordinates.\n" +
    "- find_waterways: list the real rivers, lakes and dams in an area.\n" +
    "Use these to VERIFY what you read on the map and to find features it may have missed. " +
    "When the map and OpenStreetMap agree, say so. When they disagree (e.g. a name you read isn't found), " +
    "flag it as a possible misread. When you use OpenStreetMap, say so (cite it).\n\n" +
    NO_GUESSING +
    "\nOnly state facts the tools actually confirmed. If a map detail could not be read clearly, say so and suggest a higher-resolution image.\n\n" +
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
      tools: activeTools.length ? activeTools : undefined,
      tool_choice: activeTools.length ? "auto" : undefined,
    });

    const msg = res.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { answer: msg.content ?? "", steps };
    }

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
        } else if (opts.imageBuffer) {
          const q = typeof args.question === "string" ? args.question : opts.question;
          const region: Region =
            name === "zoom_in" && (REGIONS as string[]).includes(args.region)
              ? (args.region as Region)
              : name === "zoom_in"
                ? "center"
                : "full";
          const { finding, crop } = await cropAndAsk(opts.imageBuffer, region, q);
          result = finding;
          steps.push({
            kind: "vision",
            label: region === "full" ? "Whole map" : `Zoom: ${region}`,
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
  return { answer: finalRes.choices[0]?.message?.content ?? "", steps };
}
