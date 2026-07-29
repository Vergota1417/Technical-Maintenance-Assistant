const PROHIBITED_PATTERNS = [
  { label: "lot or batch information", re: /\b(lot|batch)(?:\s*(?:number|no\.?|#|id))?\b/i },
  { label: "recall information", re: /\brecall(?:ed|s|ing)?\b/i },
  { label: "patient information", re: /\bpatient(?:s|'s)?\b/i },
  { label: "customer information", re: /\bcustomer(?:s|'s)?\b/i },
  { label: "quality disposition", re: /\b(quality disposition|nonconformance|non-conformance|ncr|capa|deviation)\b/i },
  { label: "reject or scrap quantity", re: /\b(reject(?:ed|s)?|scrap(?:ped|s)?)\b.{0,35}\b(quantity|qty|count|pieces?|units?)\b/i },
  { label: "production quantity", re: /\b(quantity|qty|count)\s*[:#-]?\s*\d+\b/i },
  { label: "product identifier", re: /\b(product|part)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*[a-z0-9_-]+\b/i },
];

const COMMON_REPLACEMENTS = [
  [/\blosts\b/gi, "lost"],
  [/\bloos(?:e|t)\b/gi, "lost"],
  [/\bpostion\b/gi, "position"],
  [/\bpositon\b/gi, "position"],
  [/\bperfrom(?:ed)?\b/gi, "performed"],
  [/\bworke?d\s+perform(?:ed)?\b/gi, "work performed"],
  [/\bresualt(?:s)?\b/gi, "results"],
  [/\btechincal\b/gi, "technical"],
  [/\bcorrect\s+location\b/gi, "correct position"],
  [/\bengiazed\b/gi, "energized"],
  [/\bmechine\b/gi, "machine"],
  [/\bmachien\b/gi, "machine"],
  [/\bsensoring\b/gi, "sensing"],
  [/\bwasnt\b/gi, "was not"],
  [/\bdidnt\b/gi, "did not"],
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "the", "to", "was", "were", "with", "machine", "equipment",
]);

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function detectProhibitedInformation(values) {
  const text = Object.values(values || {}).filter(Boolean).join(" \n ");
  const matches = [];
  for (const item of PROHIBITED_PATTERNS) {
    if (item.re.test(text)) matches.push(item.label);
  }
  return [...new Set(matches)];
}

export function cleanTechnicalText(value) {
  let text = normalizeWhitespace(value);
  for (const [pattern, replacement] of COMMON_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([^\s])/g, "$1 $2")
    .replace(/\bi\b/g, "I")
    .trim();
  return text;
}

export function sentenceCase(value) {
  const text = cleanTechnicalText(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function limitSentences(value, maxSentences = 2) {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return matches.slice(0, maxSentences).join(" ").trim();
}

export function ensurePeriod(value) {
  const text = limitSentences(sentenceCase(value), 2);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function formatIssue(raw) {
  let text = cleanTechnicalText(raw);
  text = text
    .replace(/\bindex machine\b/gi, "indexing machine")
    .replace(/\blost position on\b/gi, "lost position during")
    .replace(/\blost on\b/gi, "lost position during")
    .replace(/\bon sleeving\b/gi, "during the sleeving operation")
    .replace(/\bduring sleeving\b/gi, "during the sleeving operation")
    .replace(/\bsleeving operation operation\b/gi, "sleeving operation");
  return ensurePeriod(text);
}

function formatReason(raw) {
  let text = cleanTechnicalText(raw);
  if (/^jam\s+(on|at|in)\b/i.test(text)) {
    text = text.replace(/^jam\s+(on|at|in)\s+/i, "A jam was present at the ");
  } else if (/^a jam\s+(on|at|in)\b/i.test(text)) {
    text = text.replace(/^a jam\s+(on|at|in)\s+/i, "A jam was present at the ");
  }
  text = text.replace(/\bthe the\b/gi, "the");
  return ensurePeriod(text);
}

function formatWork(raw) {
  let text = cleanTechnicalText(raw);
  text = text
    .replace(/^performed\s+/i, "")
    .replace(/^work performed\s*[:\-]?\s*/i, "")
    .replace(/reset the clutch by moving it to (?:the )?correct position/gi, "reset the clutch to the correct indexed position")
    .replace(/moving the clutch to (?:the )?correct position/gi, "resetting the clutch to the correct indexed position");
  return ensurePeriod(text);
}

export function fallbackGenerate(input) {
  const issue = formatIssue(input.issue);
  const reason = input.reason ? formatReason(input.reason) : null;
  const workPerformed = input.work_performed ? formatWork(input.work_performed) : null;
  let results = null;
  if (input.result_confirmed) {
    const note = input.result_notes ? ensurePeriod(input.result_notes) : "";
    results = note
      ? limitSentences(`${note} Machine is running as intended.`, 2)
      : "Machine is running as intended.";
  }
  const missing = [];
  if (!reason) missing.push("reason");
  if (!workPerformed) missing.push("work_performed");
  if (!results) missing.push("results");
  return {
    issue,
    reason,
    work_performed: workPerformed,
    results,
    missing_information: missing,
    prohibited_information_detected: false,
    generation_mode: "technical-rules",
  };
}

export function tokenize(value) {
  return cleanTechnicalText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function similarityScore(query, record, machineName = "") {
  const qTokens = new Set(tokenize(query));
  const rTokens = new Set(tokenize(`${record.raw_issue || ""} ${record.issue || ""}`));
  if (!qTokens.size || !rTokens.size) return 0;

  let intersection = 0;
  for (const token of qTokens) if (rTokens.has(token)) intersection += 1;
  const precision = intersection / qTokens.size;
  const recall = intersection / rTokens.size;
  const tokenScore = precision * 0.72 + recall * 0.28;

  const normalizedQuery = cleanTechnicalText(query).toLowerCase();
  const normalizedRecord = cleanTechnicalText(record.issue || "").toLowerCase();
  const phraseBonus = normalizedRecord.includes(normalizedQuery) || normalizedQuery.includes(normalizedRecord)
    ? 0.2
    : 0;

  let machineBonus = 0;
  if (machineName && record.machine_name) {
    const left = cleanTechnicalText(machineName).toLowerCase();
    const right = cleanTechnicalText(record.machine_name).toLowerCase();
    machineBonus = left === right ? 0.12 : (left.includes(right) || right.includes(left) ? 0.06 : 0);
  }

  return Math.min(100, Math.round((tokenScore + phraseBonus + machineBonus) * 100));
}

export function parseAIResult(result) {
  if (!result) throw new Error("AI returned no result");
  if (typeof result === "object" && result.issue) return result;

  let content = null;
  if (typeof result.response === "object" && result.response !== null) return result.response;
  if (typeof result.response === "string") content = result.response;
  if (!content && result.choices?.[0]?.message?.content) content = result.choices[0].message.content;
  if (!content && typeof result === "string") content = result;
  if (!content) throw new Error("AI response did not contain text");

  const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(stripped);
}

export function enforceGeneratedOutput(output, input) {
  const cleaned = {
    issue: ensurePeriod(output.issue || input.issue),
    reason: output.reason ? ensurePeriod(output.reason) : null,
    work_performed: output.work_performed ? ensurePeriod(output.work_performed) : null,
    results: output.results ? ensurePeriod(output.results) : null,
    missing_information: Array.isArray(output.missing_information) ? output.missing_information : [],
    prohibited_information_detected: Boolean(output.prohibited_information_detected),
    generation_mode: output.generation_mode || "cloudflare-ai",
  };

  if (!input.reason) cleaned.reason = null;
  if (!input.work_performed) cleaned.work_performed = null;
  if (!input.result_confirmed) cleaned.results = null;
  if (input.result_confirmed && !cleaned.results) cleaned.results = "Machine is running as intended.";

  cleaned.missing_information = [];
  if (!cleaned.reason) cleaned.missing_information.push("reason");
  if (!cleaned.work_performed) cleaned.missing_information.push("work_performed");
  if (!cleaned.results) cleaned.missing_information.push("results");

  return cleaned;
}
