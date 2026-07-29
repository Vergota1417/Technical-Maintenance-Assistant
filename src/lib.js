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


export function expandVagueIssue(raw, machineName = "") {
  const original = cleanTechnicalText(raw);
  const text = original.toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!text) return "";

  const machine = cleanTechnicalText(machineName).replace(/[.!?]+$/g, "");
  const machineSubject = machine ? sentenceCase(machine) : "The machine";

  const exactRules = [
    [/^(bad|faulty|failed|defective) cables?$/, "One or more equipment cables were not providing a reliable electrical connection."],
    [/^(cable|cables) (issue|problem|fault)$/, "One or more equipment cables were not providing a reliable electrical connection."],
    [/^loose cables?$/, "One or more equipment cable connections were loose and could not provide a reliable electrical connection."],
    [/^(broken|damaged) cables?$/, "One or more equipment cables had a physical failure that interrupted the electrical connection."],
    [/^(bad|faulty|failed|defective) encoder$/, "The encoder was not providing reliable position feedback to the control system."],
    [/^encoder (issue|problem|fault)$/, "The encoder was not providing reliable position feedback to the control system."],
    [/^(bad|faulty|failed|defective) (sensor|prox|proximity sensor)$/, "The sensor was not providing a reliable detection signal to the control system."],
    [/^(sensor|prox|proximity sensor) (issue|problem|fault)$/, "The sensor was not providing a reliable detection signal to the control system."],
    [/^(bad|faulty|failed|defective) (photoeye|photo eye|photoelectric sensor)$/, "The photoelectric sensor was not providing a reliable target-detection signal."],
    [/^(bad|faulty|failed|defective) motor$/, "The motor was not operating as required during the machine cycle."],
    [/^motor (issue|problem|fault)$/, "The motor was not operating as required during the machine cycle."],
    [/^(bad|faulty|failed|defective) servo$/, "The servo system was not maintaining the required motion or position control."],
    [/^servo (issue|problem|fault)$/, "The servo system was not maintaining the required motion or position control."],
    [/^(bad|faulty|failed|defective) solenoid$/, "The solenoid was not actuating as required during the machine sequence."],
    [/^(bad|faulty|failed|defective) valve$/, "The valve was not actuating as required during the machine sequence."],
    [/^(bad|faulty|failed|defective) hmi$/, "The HMI was not responding or operating as required."],
    [/^(machine down|machine not working|not working|stopped working)$/, `${machineSubject} was unable to complete its normal operating sequence.`],
    [/^(machine jam|machine jammed|jammed)$/, `${machineSubject} was unable to complete its normal operating sequence due to a mechanical jam.`],
  ];

  for (const [pattern, replacement] of exactRules) {
    if (pattern.test(text)) return ensurePeriod(replacement);
  }

  const genericBadComponent = text.match(/^(?:bad|faulty|failed|defective)\s+([a-z0-9][a-z0-9 /_-]{1,45})$/i);
  if (genericBadComponent) {
    const component = genericBadComponent[1].replace(/\s+/g, " ").trim();
    return ensurePeriod(`The ${component} was not operating as required.`);
  }

  return "";
}

function looksUnhelpfullyVague(value) {
  const text = cleanTechnicalText(value).toLowerCase().replace(/[.!?]+$/g, "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  return /\b(bad|faulty|failed|defective|issue|problem|not working|machine down)\b/i.test(text);
}

function formatIssue(raw, machineName = "") {
  const expanded = expandVagueIssue(raw, machineName);
  if (expanded) return expanded;
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
  const issue = formatIssue(input.issue, input.machine_name);
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
  const expandedInputIssue = expandVagueIssue(input.issue, input.machine_name);
  let issue = ensurePeriod(output.issue || input.issue);
  if (expandedInputIssue && (looksUnhelpfullyVague(issue) || cleanTechnicalText(issue).toLowerCase() === cleanTechnicalText(input.issue).toLowerCase())) {
    issue = expandedInputIssue;
  }

  const cleaned = {
    issue,
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
