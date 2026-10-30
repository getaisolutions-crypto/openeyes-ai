// Runtime-agnostic request handling for the OpenEyes AI proxy. No Deno globals, so it can be unit tested.

export const META_API_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.3";
export const FIND_MODEL = "sam-3.1";
export const META_TIMEOUT_MS = 45_000;

export const LIMITS = {
  bodyChars: 8_000_000,
  imageDataUrlChars: 7_000_000,
  messages: 12,
  messageChars: 2000,
  totalMessageChars: 12_000,
  objectName: 80,
  memories: 5,
  memoryChars: 1000,
  question: 300,
  taskName: 120,
  previousSummary: 1000,
  planSteps: 12,
  stepChars: 240,
} as const;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export type Task = "describe" | "find" | "read" | "chat" | "quick_read" | "ask_text" | "task_plan" | "scene_check";
export type AnswerBasis = "exact" | "summary" | "inference" | "not_found";
export type SceneChangeCategory = "person" | "door" | "stairs" | "new_area" | "object" | "other";
export type ResponseLength = "brief" | "standard" | "detailed";
export type Visibility = "visible" | "not_visible" | "uncertain";
export type Confidence = "high" | "medium" | "low";

export type ErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unsupported_image"
  | "image_too_large"
  | "quota_exceeded"
  | "quota_unavailable"
  | "meta_auth_failed"
  | "meta_rate_limited"
  | "meta_rejected"
  | "meta_timeout"
  | "meta_unreachable"
  | "meta_error"
  | "meta_bad_response"
  | "internal_error";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ValidRequest {
  task: Task;
  responseLength: ResponseLength;
  image?: { dataUrl: string; capturedAt?: string };
  objectName?: string;
  question?: string;
  taskName?: string;
  previousSummary?: string;
  messages: ChatTurn[];
  memories: string[];
}

export interface QuickReadResult {
  readable: boolean;
  documentType: string;
  keyText: string;
  summary: string;
  reason: string;
}

export interface AskTextResult {
  answer: string;
  basis: AnswerBasis;
  quote: string;
}

export interface SceneCheckResult {
  summary: string;
  objects: string[];
  changes: { category: SceneChangeCategory; text: string }[];
  confidence: Confidence;
}

export interface FindResult {
  visibility: Visibility;
  position: string;
  confidence: Confidence;
  suggestion: string;
}

export interface HandlerDeps {
  apiKey?: string;
  model: string;
  fetchImpl: typeof fetch;
  consumeQuota: (clientHash: string) => Promise<boolean>;
  now?: () => Date;
  timeoutMs?: number;
  /** Explicit rollback switch; deployed entry point enables SAM. */
  findModel?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const TASKS: Task[] = ["describe", "find", "read", "chat", "quick_read", "ask_text", "task_plan", "scene_check"];
const IMAGE_TASKS: Task[] = ["describe", "find", "read", "quick_read", "ask_text", "scene_check"];
const LENGTHS: ResponseLength[] = ["brief", "standard", "detailed"];

function clean(value: string, max: number): string {
  // deno-lint-ignore no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function invalid(message: string): never {
  throw new HttpError(400, "invalid_request", message);
}

export function validateRequest(body: unknown): ValidRequest {
  if (typeof body !== "object" || body === null) invalid("Request body must be a JSON object.");
  const b = body as Record<string, unknown>;

  const task = b.task as Task;
  if (!TASKS.includes(task)) invalid("Unknown task.");
  const responseLength = LENGTHS.includes(b.responseLength as ResponseLength)
    ? (b.responseLength as ResponseLength)
    : "brief";

  let image: ValidRequest["image"];
  if (b.image !== undefined && b.image !== null) {
    const img = b.image as Record<string, unknown>;
    if (typeof img.dataUrl !== "string") invalid("Image must be a data URL.");
    if (img.dataUrl.length > LIMITS.imageDataUrlChars) {
      throw new HttpError(413, "image_too_large", "The photo is too large to process.");
    }
    if (!IMAGE_DATA_URL.test(img.dataUrl)) {
      throw new HttpError(415, "unsupported_image", "Only JPEG, PNG or WebP photos can be processed.");
    }
    const capturedAt = typeof img.capturedAt === "string" && !Number.isNaN(Date.parse(img.capturedAt))
      ? img.capturedAt
      : undefined;
    image = { dataUrl: img.dataUrl, capturedAt };
  }
  if (IMAGE_TASKS.includes(task) && !image) invalid("A photo is required.");

  let question: string | undefined;
  if (task === "ask_text") {
    question = typeof b.question === "string" ? clean(b.question.replace(/[\n\r]/g, " "), LIMITS.question) : "";
    if (!question) invalid("Ask a question about the text.");
  }

  let taskName: string | undefined;
  if (task === "task_plan") {
    taskName = typeof b.taskName === "string" ? clean(b.taskName.replace(/["\n\r]/g, " "), LIMITS.taskName) : "";
    if (!taskName) invalid("Say which task you need help with.");
  }

  let previousSummary: string | undefined;
  if (task === "scene_check" && typeof b.previousSummary === "string") {
    previousSummary = clean(b.previousSummary.replace(/[\n\r]/g, " "), LIMITS.previousSummary) || undefined;
  }

  let objectName: string | undefined;
  if (task === "find") {
    objectName = typeof b.objectName === "string" ? clean(b.objectName.replace(/["\n\r]/g, " "), LIMITS.objectName) : "";
    if (!objectName) invalid("Say what to look for.");
  }

  const messages: ChatTurn[] = [];
  if (task === "chat") {
    if (!Array.isArray(b.messages) || b.messages.length === 0) invalid("At least one message is required.");
    let total = 0;
    for (const raw of b.messages.slice(-LIMITS.messages)) {
      const m = raw as Record<string, unknown>;
      if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") invalid("Invalid message.");
      const content = clean(m.content, LIMITS.messageChars);
      if (!content) continue;
      total += content.length;
      messages.push({ role: m.role, content });
    }
    while (total > LIMITS.totalMessageChars && messages.length > 1) total -= messages.shift()!.content.length;
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      invalid("The last message must come from the user.");
    }
  }

  const memories = Array.isArray(b.memories)
    ? b.memories
        .filter((m): m is string => typeof m === "string")
        .map((m) => clean(m, LIMITS.memoryChars))
        .filter(Boolean)
        .slice(0, LIMITS.memories)
    : [];

  return { task, responseLength, image, objectName, question, taskName, previousSummary, messages, memories };
}

const SAFETY_RULES = `You are OpenEyes, an assistant for blind and low-vision people.
Rules you must always follow:
- Only describe what is actually visible in the provided photo. Never invent objects, text, people or details.
- If something is blurry, dark, partly hidden or ambiguous, say plainly that you are not sure.
- Use plain spoken language suitable for text-to-speech. No markdown, no headings, no bullet symbols.
- Describe positions relative to the photo (left, right, centre, near the bottom, in the background, next to another object). Never give distances in metres, feet or steps.
- You cannot judge safety. Never say a path, street, crossing, stairs or area is safe or clear, and never give walking or navigation directions. If asked about traffic, moving vehicles, drop-offs, obstacles or safe routes, say you cannot reliably judge that from a photo and suggest relying on their cane, guide dog, mobility training or a trusted person.
- Do not identify people by name from their appearance.`;

const LENGTH_RULES: Record<ResponseLength, string> = {
  brief: "Answer in one or two short sentences.",
  standard: "Answer in at most four sentences.",
  detailed: "Answer in at most eight sentences.",
};

function describeAge(capturedAt: string | undefined, now: Date): string {
  if (!capturedAt) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(capturedAt)) / 1000));
  if (seconds < 90) return "less than two minutes ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `about ${minutes} minutes ago`;
  return `about ${Math.round(minutes / 60)} hours ago`;
}

function imagePart(dataUrl: string) {
  return { type: "image_url", image_url: { url: dataUrl } };
}

function memoryBlock(memories: string[]): string {
  if (memories.length === 0) return "";
  return `\n\nNotes the user saved and approved earlier. They are NOT current observations. When you use one, say it is something the user saved, for example "You saved a note that...". Never present them as what the camera sees now:\n${memories
    .map((m) => `- ${m}`)
    .join("\n")}`;
}

export function buildMetaRequest(req: ValidRequest, model: string, now: Date) {
  const maxTokens = req.task === "read" ? 4096 : 2048;
  const length = LENGTH_RULES[req.responseLength];

  if (req.task === "describe") {
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: `${SAFETY_RULES}\n${length}` },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this photo for me. Start with the most important thing. Mention the main objects and where they are, any readable text that matters, and important details about the surroundings. Say clearly what you are unsure about.",
            },
            imagePart(req.image!.dataUrl),
          ],
        },
      ],
    };
  }

  if (req.task === "read") {
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `You transcribe text from photos for a blind user.
- Output only the text that is actually readable in the photo, exactly as written. Preserve meaningful line breaks.
- Do not correct, complete, summarise, translate or explain anything.
- Write [unreadable] where a part of the text cannot be read.
- If there is no readable text at all, output exactly: NO_READABLE_TEXT`,
        },
        { role: "user", content: [{ type: "text", text: "Transcribe the text in this photo." }, imagePart(req.image!.dataUrl)] },
      ],
    };
  }

  if (req.task === "find") {
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `${SAFETY_RULES}
You help the user check whether a specific item is visible in a photo.
Reply with only a JSON object, no other text, in this exact shape:
{"visibility":"visible"|"not_visible"|"uncertain","position":"...","confidence":"high"|"medium"|"low","suggestion":"..."}
- "visible" only if you can actually see the item. If you cannot see it, use "not_visible". If something might be the item but you cannot tell, use "uncertain".
- "position": one short sentence saying where it is in the photo, using camera-relative words such as on the left of the image, on the right, near the centre, at the top, at the bottom, beside, behind, on top of or under another visible object. Example: "on the table, near the laptop, on the left of the image". Empty string if not visible.
- Never say the item is reachable, close, far, or safe to approach.
- "suggestion": one short practical next step, such as moving the camera, adding light, or taking a closer photo.
- No distances.`,
        },
        {
          role: "user",
          content: [{ type: "text", text: `Item to look for: "${req.objectName}".` }, imagePart(req.image!.dataUrl)],
        },
      ],
    };
  }

  if (req.task === "quick_read") {
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `You help a blind user understand printed text in a photo, such as letters, receipts, product labels, menus, instructions, signs, forms, packaging or simple tables.
Reply with only a JSON object, no other text, in this exact shape:
{"readable":true|false,"documentType":"...","keyText":"...","summary":"...","reason":"..."}
- "keyText": only the most important text, copied exactly as written (titles, names, dates, amounts, warnings). Use line breaks between items. Write [unreadable] for parts you cannot read. Never guess or complete words.
- "documentType": one or two words, for example "letter", "receipt", "product label", "menu", "sign", or "unknown".
- "summary": one short plain sentence saying what the document seems to be. This is your interpretation, not a quotation.
- If the text is too blurry, dark, cut off or small to read reliably, set "readable" to false, leave keyText empty, and explain why in "reason" (for example "The photo is blurry").`,
        },
        { role: "user", content: [{ type: "text", text: "What are the most important things written here?" }, imagePart(req.image!.dataUrl)] },
      ],
    };
  }

  if (req.task === "ask_text") {
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `You answer a blind user's question about the printed text in a photo. Use only what is written in the photo.
Reply with only a JSON object, no other text, in this exact shape:
{"answer":"...","basis":"exact"|"summary"|"inference"|"not_found","quote":"..."}
- "exact": the answer is stated directly in the text. Put the exact words in "quote".
- "summary": you condensed several parts of the text. "quote" may be empty.
- "inference": the text does not say it directly and you reasoned from it. Say so in the answer.
- "not_found": the text does not contain the answer, or it is unreadable. Never guess.
- "answer": one or two short spoken sentences, no markdown. Never invent words that are not readable.`,
        },
        {
          role: "user",
          content: [{ type: "text", text: `Question about this document: "${req.question}"` }, imagePart(req.image!.dataUrl)],
        },
      ],
    };
  }

  if (req.task === "task_plan") {
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `You write short step-by-step instructions for a blind or low-vision person doing an everyday task at home.
Reply with only a JSON object, no other text, in this exact shape:
{"steps":["...","..."]}
- 3 to ${LIMITS.planSteps} steps, each one short spoken sentence, no numbering, no markdown.
- Prefer touch, sound and smell cues over visual cues.
- Include a short caution in the relevant step when heat, sharp objects, electricity or chemicals are involved.
- Never claim you can see the user. Never give street, travel or navigation directions; if the task needs them, return {"steps":[]}.
- If the request is not an everyday task you can describe safely, return {"steps":[]}.`,
        },
        { role: "user", content: `Task: "${req.taskName}"` },
      ],
    };
  }

  if (req.task === "scene_check") {
    const previous = req.previousSummary
      ? `The previous camera image was summarised as: "${req.previousSummary}". Compare with it.`
      : "There is no previous image to compare with.";
    return {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `${SAFETY_RULES}
You describe the current camera view naturally to a blind person, as a helpful person beside them would.
${length} Start directly with the scene. Do not say "the image shows", "I can see", or announce that you are analysing.
Mention only the main things and useful camera-relative positions. Do not list every object, decorative detail, colour, lighting change or repeated background feature.
Give uncertainty only when it matters. Do not append generic reminders or advice to every description.
Reply with only a JSON object, no other text, in this exact shape:
{"summary":"...","objects":["..."],"changes":[{"category":"person"|"door"|"stairs"|"new_area"|"object"|"other","text":"..."}],"confidence":"high"|"medium"|"low"}
- "summary": ${req.responseLength === "brief" ? "one or two short spoken sentences, at most 45 words" : "up to four short spoken sentences, at most 85 words"} about the current view. Example: "A table is ahead, with a mug on its left. A doorway is on the right."
- "objects": up to 8 main visible things, a few words each.
- "changes": at most two meaningful differences clearly supported by the image, spoken directly, for example "A person is near the doorway." Use "new_area" when looking at a different place. Ignore exposure shifts, camera shake, small framing differences and cosmetic changes. Do not describe the camera moving as objects moving. Never infer speed, direction of travel or what will happen next. Empty list if nothing meaningful changed or there is no previous summary.
- Never say a path is clear or safe, never say there are no obstacles, never give movement instructions.`,
        },
        { role: "user", content: [{ type: "text", text: previous }, imagePart(req.image!.dataUrl)] },
      ],
    };
  }

  const imageNote = req.image
    ? `\n\nA photo is attached to the latest user message. It was taken ${describeAge(req.image.capturedAt, now)}. It is the only current camera evidence. Earlier messages may describe older photos; treat those as past observations and say so if you rely on them.`
    : "\n\nNo photo is attached, so you cannot see the user's surroundings right now. If they ask about what is around them, tell them to add a photo first. Do not guess.";

  const history = req.messages.map((m, index) => {
    const isLast = index === req.messages.length - 1;
    if (isLast && req.image) {
      return { role: "user", content: [{ type: "text", text: m.content }, imagePart(req.image.dataUrl)] };
    }
    return { role: m.role, content: m.content };
  });

  return {
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: `${SAFETY_RULES}\n${length}${imageNote}${memoryBlock(req.memories)}` },
      ...history,
    ],
  };
}

export function extractContent(json: unknown): string {
  const choice = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""))
      .join("")
      .trim();
  }
  return "";
}

export function parseFindResult(content: string): FindResult {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  }
  const visibility = (["visible", "not_visible", "uncertain"] as const).find((v) => v === parsed.visibility);
  if (!visibility) throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  const confidence = (["high", "medium", "low"] as const).find((c) => c === parsed.confidence) ?? "low";
  const position = visibility === "not_visible" || typeof parsed.position !== "string" ? "" : clean(parsed.position, 400);
  const suggestion = typeof parsed.suggestion === "string" ? clean(parsed.suggestion, 400) : "";
  return { visibility: visibility === "visible" && confidence !== "high" ? "uncertain" : visibility, position, confidence, suggestion };
}

export interface DetectionBox { x1: number; y1: number; x2: number; y2: number; w: number; h: number; confidence: number }

/** SAM pixel coordinates are used only for camera-relative location, never distance or reachability. */
export function parseSamDetections(text: string): DetectionBox[] {
  if (!text.trim()) return [];
  const line = text.trim();
  if (!line.startsWith("<0f>")) throw new HttpError(502, "meta_bad_response", "Invalid detection frame.");
  const boxes: DetectionBox[] = [];
  const record = /(?:^|,)\d+<\|box;([^|]+)\|><\|mask;[\s\S]*?\|>/g;
  const records = line.slice(4);
  let end = 0;
  for (const match of records.matchAll(record)) {
    if (match.index !== end || boxes.length >= 128) throw new HttpError(502, "meta_bad_response", "Invalid detection record.");
    end = match.index + match[0].length;
    const fields = Object.fromEntries(match[1].split(";").map((part) => part.split("=")));
    const values = ["x1", "y1", "x2", "y2", "w", "h"].map((key) => Number(fields[key]));
    const [x1, y1, x2, y2, w, h] = values;
    const confidence = fields.c === undefined ? 0 : Number(fields.c);
    if (values.some((v) => !Number.isSafeInteger(v) || v < 0) || w < 1 || h < 1 ||
        x2 < x1 || y2 < y1 || x2 >= w || y2 >= h || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new HttpError(502, "meta_bad_response", "Invalid detection coordinates.");
    }
    boxes.push({ x1, y1, x2, y2, w, h, confidence });
  }
  if (!boxes.length || end !== records.length) throw new HttpError(502, "meta_bad_response", "Incomplete detection result.");
  return boxes;
}

export function detectionResult(boxes: DetectionBox[]): FindResult {
  if (!boxes.length) return { visibility: "not_visible", position: "", confidence: "low", suggestion: "Look around slowly." };
  const best = [...boxes].sort((a, b) => b.confidence - a.confidence)[0];
  const cx = (best.x1 + best.x2) / (2 * best.w), cy = (best.y1 + best.y2) / (2 * best.h);
  const horizontal = cx < 0.35 ? "left" : cx > 0.65 ? "right" : "centre";
  const vertical = cy < 0.35 ? "upper" : cy > 0.65 ? "lower" : "middle";
  // Conservative operating threshold; this is not a calibrated probability of correctness.
  const confident = best.confidence >= 0.85;
  return { visibility: confident ? "visible" : "uncertain", confidence: confident ? "high" : "low",
    position: `${boxes.length > 1 ? "one matching object " : ""}in the ${vertical} ${horizontal} of your view`, suggestion: "" };
}

async function findWithSam(req: ValidRequest, deps: HandlerDeps): Promise<FindResult> {
  const body = {
    model: deps.findModel, stream: false,
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: req.objectName },
      { type: "input_image", image_url: req.image!.dataUrl },
    ] }],
  };
  const response = await fetchMetaJson("/responses", body, { apiKey: deps.apiKey!, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs ?? 12_000 });
  if (response.status !== "completed" || !Array.isArray(response.output)) {
    throw new HttpError(502, "meta_bad_response", "Object detection did not complete.");
  }
  const parts = response.output.flatMap((item: { type?: string; content?: { type?: string; text?: string }[] }) =>
    item.type === "message" && Array.isArray(item.content) ? item.content : []);
  if (parts.some((part: { type?: string }) => part.type !== "output_text")) {
    throw new HttpError(502, "meta_bad_response", "Object detection did not return geometry.");
  }
  const text = parts.map((part: { text?: string }) => {
    if (typeof part.text !== "string") throw new HttpError(502, "meta_bad_response", "Invalid detection text.");
    return part.text;
  }).join("");
  return detectionResult(parseSamDetections(text));
}

function parseJsonObject(content: string): Record<string, unknown> {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "";
}

export function parseQuickReadResult(content: string): QuickReadResult {
  const p = parseJsonObject(content);
  const keyText = str(p.keyText, 4000);
  const readable = p.readable === true && keyText.length > 0;
  return {
    readable,
    documentType: str(p.documentType, 40) || "unknown",
    keyText: readable ? keyText : "",
    summary: readable ? str(p.summary, 400) : "",
    reason: readable ? "" : str(p.reason, 200),
  };
}

const BASES: AnswerBasis[] = ["exact", "summary", "inference", "not_found"];

export function parseAskTextResult(content: string): AskTextResult {
  const p = parseJsonObject(content);
  const answer = str(p.answer, 800);
  const basis = BASES.find((b) => b === p.basis);
  if (!answer || !basis) throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  return { answer, basis, quote: basis === "not_found" ? "" : str(p.quote, 800) };
}

export function parseTaskPlan(content: string): { steps: string[] } {
  const p = parseJsonObject(content);
  if (!Array.isArray(p.steps)) throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  const steps = p.steps.map((s) => str(s, LIMITS.stepChars)).filter(Boolean).slice(0, LIMITS.planSteps);
  return { steps };
}

const CATEGORIES: SceneChangeCategory[] = ["person", "door", "stairs", "new_area", "object", "other"];

export function parseSceneCheck(content: string): SceneCheckResult {
  const p = parseJsonObject(content);
  const summary = str(p.summary, 400);
  if (!summary) throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  const objects = Array.isArray(p.objects) ? p.objects.map((o) => str(o, 60)).filter(Boolean).slice(0, 8) : [];
  const changes = Array.isArray(p.changes)
    ? p.changes
        .map((c) => {
          const item = (c ?? {}) as Record<string, unknown>;
          const category = CATEGORIES.find((k) => k === item.category) ?? "other";
          return { category, text: str(item.text, 240) };
        })
        .filter((c) => c.text)
        .slice(0, 4)
    : [];
  const confidence = (["high", "medium", "low"] as const).find((c) => c === p.confidence) ?? "low";
  return { summary, objects, changes, confidence };
}

const NO_TEXT = "NO_READABLE_TEXT";

export function parseReadResult(content: string): { text: string; readable: boolean } {
  const text = content.trim();
  if (!text || text === NO_TEXT || (text.includes(NO_TEXT) && text.length < NO_TEXT.length + 20)) {
    return { text: "", readable: false };
  }
  return { text, readable: true };
}

export async function callMeta(
  body: unknown,
  { apiKey, fetchImpl, timeoutMs = META_TIMEOUT_MS }: { apiKey: string; fetchImpl: typeof fetch; timeoutMs?: number },
): Promise<{ content: string; model: string }> {
  const json = await fetchMetaJson("/chat/completions", body, { apiKey, fetchImpl, timeoutMs });
  const content = extractContent(json);
  if (!content) throw new HttpError(502, "meta_bad_response", "Meta AI returned an empty answer.");
  return { content, model: typeof json.model === "string" ? json.model : "" };
}

async function fetchMetaJson(
  path: string, body: unknown,
  { apiKey, fetchImpl, timeoutMs = META_TIMEOUT_MS }: { apiKey: string; fetchImpl: typeof fetch; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${META_API_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(502, "meta_auth_failed", "The Meta API key was rejected.");
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new HttpError(429, "meta_rate_limited", "Meta AI is busy.", Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  if (response.status >= 400 && response.status < 500) {
    throw new HttpError(502, "meta_rejected", "Meta AI could not process this request.");
  }
  if (!response.ok) throw new HttpError(502, "meta_error", "Meta AI had a problem.");

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new HttpError(502, "meta_bad_response", "The AI answer could not be understood.");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new HttpError(502, "meta_bad_response", "Invalid model response.");
  return json as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError(504, "meta_timeout", "Meta AI took too long to answer.");
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "meta_unreachable", "Meta AI could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientId(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method === "GET") return json(200, { configured: Boolean(deps.apiKey), model: deps.model });
    if (req.method !== "POST") throw new HttpError(405, "invalid_request", "Method not allowed.");
    if (!deps.apiKey) {
      throw new HttpError(503, "not_configured", "The Meta API key has not been added to the OpenEyes server.");
    }

    const raw = await req.text();
    if (raw.length > LIMITS.bodyChars) throw new HttpError(413, "image_too_large", "The photo is too large to process.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      invalid("Request body must be valid JSON.");
    }
    const valid = validateRequest(body);

    let allowed: boolean;
    try {
      allowed = await deps.consumeQuota(await sha256(clientId(req)));
    } catch {
      throw new HttpError(503, "quota_unavailable", "OpenEyes could not check its usage limit.");
    }
    if (!allowed) throw new HttpError(429, "quota_exceeded", "Too many requests. Please wait a few minutes.", 60);

    if (valid.task === "find" && deps.findModel) {
      const find = await findWithSam(valid, deps);
      return json(200, { task: "find", model: deps.findModel, find });
    }

    const now = deps.now?.() ?? new Date();
    const metaBody = buildMetaRequest(valid, deps.model, now);
    const { content, model } = await callMeta(metaBody, {
      apiKey: deps.apiKey,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    });
    const usedModel = model || deps.model;

    if (valid.task === "find") return json(200, { task: "find", model: usedModel, find: parseFindResult(content) });
    if (valid.task === "read") return json(200, { task: "read", model: usedModel, ...parseReadResult(content) });
    if (valid.task === "quick_read") return json(200, { task: valid.task, model: usedModel, quickRead: parseQuickReadResult(content) });
    if (valid.task === "ask_text") return json(200, { task: valid.task, model: usedModel, answer: parseAskTextResult(content) });
    if (valid.task === "task_plan") return json(200, { task: valid.task, model: usedModel, plan: parseTaskPlan(content) });
    if (valid.task === "scene_check") return json(200, { task: valid.task, model: usedModel, scene: parseSceneCheck(content) });
    return json(200, { task: valid.task, model: usedModel, text: content });
  } catch (error) {
    if (error instanceof HttpError) {
      const extra: Record<string, string> = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
      return json(
        error.status,
        { error: { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds } },
        extra,
      );
    }
    console.error("openeyes-ai internal error", error instanceof Error ? error.message : "unknown");
    return json(500, { error: { code: "internal_error", message: "Something went wrong on the OpenEyes server." } });
  }
}
