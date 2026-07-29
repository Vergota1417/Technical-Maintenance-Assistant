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
  [/\bloost\b/gi, "lost"],
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
  [/\bcom+p+l+e+t+e\b/gi, "complete"],
  [/\bcomplette\b/gi, "complete"],
  [/\bcompelte\b/gi, "complete"],
  [/\bcomplte\b/gi, "complete"],
  [/\breplased\b/gi, "replaced"],
  [/\brepleced\b/gi, "replaced"],
  [/\brepalced\b/gi, "replaced"],
  [/\bcabels?\b/gi, (match) => match.toLowerCase().endsWith("s") ? "cables" : "cable"],
  [/\bconection\b/gi, "connection"],
  [/\bconnetion\b/gi, "connection"],
  [/\bconnecton\b/gi, "connection"],
  [/\bmotar\b/gi, "motor"],
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
    .replace(/\b([uvw])\s+(terminal|connection|phase)\b/gi, (_, phase, label) => `${phase.toUpperCase()} ${label.toLowerCase()}`)
    .trim();
  return text;
}

export function sentenceCase(value) {
  const text = cleanTechnicalText(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function technicalNounPhrase(value) {
  return cleanTechnicalText(value)
    .split(/\s+/)
    .map((word) => (/^[A-Z0-9/\-]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

export function limitSentences(value, maxSentences = 2) {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return matches.slice(0, maxSentences).map((sentence) => sentence.trim()).join(" ").trim();
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

  const motorTerminalMatch = text.match(/\b(?:bad|faulty|failed|defective)?\s*motor\b.*?\b([uvw])(?:\s*(?:terminal|connection|phase))?\b/i);
  if (motorTerminalMatch) {
    const phase = motorTerminalMatch[1].toUpperCase();
    const subject = machine
      ? `The ${technicalNounPhrase(machine).replace(/[.!?]+$/g, "")} motor`
      : "The motor";
    return ensurePeriod(`${subject} was not operating as required, and the reported condition was associated with the ${phase}-terminal electrical connection. This prevented reliable motor operation during the machine cycle.`);
  }

  const exactRules = [
    [/^(bad|faulty|failed|defective) cables?$/, "One or more equipment cables were not providing a reliable electrical connection. This created an unstable electrical path within the affected machine circuit."],
    [/^(cable|cables) (issue|problem|fault|error)$/, "One or more equipment cables were not providing a reliable electrical connection. This created an unstable electrical path within the affected machine circuit."],
    [/^loose cables?$/, "One or more equipment cable connections were loose and could not provide reliable electrical continuity. The affected circuit could not maintain a stable connection during operation."],
    [/^(broken|damaged) cables?$/, "One or more equipment cables had a physical failure that interrupted electrical continuity. The affected machine circuit could not maintain a reliable connection."],
    [/^(bad|faulty|failed|defective) encoder$/, "The encoder was not providing reliable position feedback to the control system. The controller could not consistently verify the associated machine position or movement."],
    [/^encoder (issue|problem|fault|error)$/, "The encoder was not providing reliable position feedback to the control system. The controller could not consistently verify the associated machine position or movement."],
    [/^(bad|faulty|failed|defective) (sensor|prox|proximity sensor)$/, "The sensor was not providing a reliable detection signal to the control system. The affected machine condition could not be consistently confirmed during the operating sequence."],
    [/^(sensor|prox|proximity sensor) (issue|problem|fault|error)$/, "The sensor was not providing a reliable detection signal to the control system. The affected machine condition could not be consistently confirmed during the operating sequence."],
    [/^(bad|faulty|failed|defective) (photoeye|photo eye|photoelectric sensor)$/, "The photoelectric sensor was not providing a reliable target-detection signal. The control system could not consistently confirm the target condition during the machine sequence."],
    [/^(bad|faulty|failed|defective) motor$/, "The motor was not operating as required during the machine cycle. The associated mechanical motion was unavailable or inconsistent."],
    [/^motor (issue|problem|fault|error)$/, "The motor was not operating as required during the machine cycle. The associated mechanical motion was unavailable or inconsistent."],
    [/^(bad|faulty|failed|defective) servo$/, "The servo system was not maintaining the required motion or position control. The affected axis could not complete its commanded movement reliably."],
    [/^servo (issue|problem|fault|error)$/, "The servo system was not maintaining the required motion or position control. The affected axis could not complete its commanded movement reliably."],
    [/^(bad|faulty|failed|defective) solenoid$/, "The solenoid was not actuating as required during the machine sequence. The associated pneumatic or mechanical function could not operate reliably."],
    [/^(bad|faulty|failed|defective) valve$/, "The valve was not actuating as required during the machine sequence. The associated flow or actuator function could not operate reliably."],
    [/^(bad|faulty|failed|defective) hmi$/, "The HMI was not responding or operating as required. Machine status and control functions could not be accessed reliably from the interface."],
    [/^(machine down|machine not working|not working|stopped working)$/, `${machineSubject} was unable to complete its normal operating sequence. The equipment remained unavailable for normal operation until the condition was corrected.`],
    [/^(machine jam|machine jammed|jammed)$/, `${machineSubject} was unable to complete its normal operating sequence due to a mechanical jam. The jam interrupted movement through the affected section of the machine.`],
  ];

  for (const [pattern, replacement] of exactRules) {
    if (pattern.test(text)) return ensurePeriod(replacement);
  }

  const componentRules = [
    { re: /\bencoder\b/i, text: "The encoder was not providing reliable position feedback to the control system. The controller could not consistently verify the associated machine position or movement." },
    { re: /\b(photo ?eye|photoelectric sensor)\b/i, text: "The photoelectric sensor was not providing a reliable target-detection signal. The control system could not consistently confirm the target condition during the machine sequence." },
    { re: /\b(prox|proximity sensor|sensor)\b/i, text: "The sensor was not providing a reliable detection signal to the control system. The affected machine condition could not be consistently confirmed during the operating sequence." },
    { re: /\b(cable|wire|wiring|connector)\b/i, text: "The affected electrical connection was not providing reliable continuity. This created an unstable signal or power path within the machine circuit." },
    { re: /\bservo\b/i, text: "The servo system was not maintaining the required motion or position control. The affected axis could not complete its commanded movement reliably." },
    { re: /\b(motor|drive motor)\b/i, text: "The motor was not operating as required during the machine cycle. The associated mechanical motion was unavailable or inconsistent." },
    { re: /\b(vfd|variable frequency drive|drive)\b/i, text: "The motor drive was not controlling the commanded motor operation reliably. The associated machine motion could not run as required." },
    { re: /\b(solenoid|valve)\b/i, text: "The control device was not actuating as required during the machine sequence. The associated pneumatic or mechanical function could not operate reliably." },
    { re: /\b(cylinder|actuator)\b/i, text: "The actuator was not completing its commanded movement. The associated machine function could not reach the required operating position." },
    { re: /\b(hmi|screen|display)\b/i, text: "The HMI was not responding or displaying machine information as required. Machine status and control functions could not be accessed reliably from the interface." },
    { re: /\b(plc input|input signal|input)\b/i, text: "The control system was not receiving a reliable input signal from the field device. The associated machine condition could not be confirmed by the PLC." },
    { re: /\b(plc output|output signal|output)\b/i, text: "The control system output was not operating the connected field device as required. The associated machine function did not respond to the command reliably." },
    { re: /\b(heater|heating|temperature zone)\b/i, text: "The heating circuit was not maintaining the required temperature condition. The affected zone could not reach or hold its commanded operating temperature." },
    { re: /\b(rtd|thermocouple|temperature sensor)\b/i, text: "The temperature sensor was not providing a reliable process-temperature signal. The controller could not consistently verify the affected zone temperature." },
    { re: /\b(vacuum)\b/i, text: "The vacuum system was not reaching or maintaining the required operating level. The associated pick or holding function could not operate reliably." },
    { re: /\b(conveyor|belt)\b/i, text: "The conveyor was not operating as required during the machine sequence. Material-transfer motion through the affected section was interrupted or inconsistent." },
    { re: /\b(safety|interlock|guard switch)\b/i, text: "The safety circuit was not reaching the required reset or run condition. The control system prevented normal machine operation until the safety condition was restored." },
    { re: /\b(robot)\b/i, text: "The robot was not completing its commanded operating sequence. The affected automated motion remained interrupted until the fault condition was corrected." },
    { re: /\b(network|communication|remote i\/o|ethernet)\b/i, text: "The industrial communication connection was not exchanging data reliably. The controller could not consistently communicate with the affected device or I/O station." },
  ];

  const shortFailure = /\b(bad|faulty|failed|defective|issue|problem|fault|error|intermittent|unstable|not working|no signal|not reading|stopped|loose|broken|damaged)\b/i.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (shortFailure && wordCount <= 8) {
    for (const rule of componentRules) {
      if (rule.re.test(text)) return ensurePeriod(rule.text);
    }
  }

  const genericBadComponent = text.match(/^(?:bad|faulty|failed|defective)\s+([a-z0-9][a-z0-9 /_-]{1,45})$/i);
  if (genericBadComponent) {
    const component = genericBadComponent[1].replace(/\s+/g, " ").trim();
    return ensurePeriod(`The ${component} was not operating as required. This prevented reliable operation of the associated machine function.`);
  }

  return "";
}

function looksUnhelpfullyVague(value, originalInput = "") {
  const text = cleanTechnicalText(value).toLowerCase().replace(/[.!?]+$/g, "").trim();
  const original = cleanTechnicalText(originalInput).toLowerCase().replace(/[.!?]+$/g, "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (original && text === original) return true;
  if (words.length < 6) return true;
  return words.length <= 10 && /\b(bad|faulty|failed|defective|issue|problem|not working|machine down)\b/i.test(text);
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

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 5 && machineName) {
    const subject = sentenceCase(machineName).replace(/[.!?]+$/g, "");
    return ensurePeriod(`${subject} experienced the reported ${text.toLowerCase()} condition. The condition affected reliable completion of the associated machine function.`);
  }
  return ensurePeriod(text);
}

function findMotorTerminal(...values) {
  const text = cleanTechnicalText(values.filter(Boolean).join(" "));
  const match = text.match(/\b([uvw])(?:\s*[- ]?\s*(?:terminal|connection|phase))\b/i);
  return match ? match[1].toUpperCase() : "";
}

function formatReason(raw, context = {}) {
  let text = cleanTechnicalText(raw);
  const lower = text.toLowerCase().replace(/[.!?]+$/g, "");
  const terminal = findMotorTerminal(context.issue, raw);
  const terminalLocation = terminal ? ` at the motor's ${terminal}-terminal connection` : "";
  const rules = [
    [/^(bad|faulty|failed|defective) cables?$/, "The affected cable was not providing reliable electrical continuity."],
    [/^loose (cable|connector|connection)$/, "A loose electrical connection caused an intermittent signal or power path."],
    [/^(bad|faulty|failed|defective) encoder$/, "The encoder was not providing reliable position feedback to the control system."],
    [/^(bad|faulty|failed|defective) sensor$/, "The sensor was not providing a reliable detection signal to the control system."],
    [/^sensor (dirty|blocked)$/, "Contamination on the sensor face interfered with reliable target detection."],
    [/^sensor misaligned$/, "The sensor was misaligned with its target and could not switch reliably."],
    [/^(low|no) air( pressure)?$/, "Insufficient pneumatic pressure prevented normal actuator operation."],
    [/^mechanical jam$/, "A mechanical jam prevented the affected mechanism from completing its normal movement."],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(lower)) return ensurePeriod(replacement);
  }

  const colorCableWire = lower.match(/^(?:bad|faulty|failed|defective|damaged|broken)\s+(?:wire|conductor)\s+(?:on|in|at)\s+(?:the\s+)?([a-z]+)\s+cable$/i);
  if (colorCableWire) {
    return ensurePeriod(`A defective conductor was identified in the ${colorCableWire[1]} cable${terminalLocation}.`);
  }

  const badWire = lower.match(/^(?:bad|faulty|failed|defective|damaged|broken)\s+(?:wire|conductor)$/i);
  if (badWire) {
    return ensurePeriod(`A defective conductor was identified in the affected cable${terminalLocation}.`);
  }

  const looseColorCable = lower.match(/^loose\s+(?:wire|conductor|connection)\s+(?:on|in|at)\s+(?:the\s+)?([a-z]+)\s+cable$/i);
  if (looseColorCable) {
    return ensurePeriod(`A loose conductor connection was identified in the ${looseColorCable[1]} cable${terminalLocation}.`);
  }

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
  const lower = text.toLowerCase().replace(/[.!?]+$/g, "");
  const rules = [
    [/^(fixed|repaired) cables?$/, "Repaired and secured the affected cable connection."],
    [/^(replaced|changed) cables?$/, "Replaced the affected cable and secured the electrical connection."],
    [/^(replaced|changed) encoder$/, "Removed the failed encoder and installed a replacement unit."],
    [/^(reset|realigned) encoder$/, "Realigned the encoder with the associated position reference."],
    [/^(cleaned) sensor$/, "Cleaned the sensor face to remove material from the sensing surface."],
    [/^(replaced|changed) sensor$/, "Removed the failed sensor and installed a replacement unit."],
    [/^(aligned|realigned) sensor$/, "Realigned the sensor with its intended detection target."],
    [/^reset clutch$/, "Reset the clutch to the correct indexed position."],
    [/^(cleared|removed) jam$/, "Cleared the mechanical jam and restored free movement of the affected mechanism."],
    [/^reset machine$/, "Reset the machine control sequence."],
    [/^(replaced|changed) (?:the )?(?:complete|entire|whole) motor$/, "Removed the existing motor and installed a complete replacement motor assembly."],
    [/^(replaced|changed) (?:the )?motor$/, "Removed the existing motor and installed a replacement motor assembly."],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(lower)) return ensurePeriod(replacement);
  }
  text = text
    .replace(/^performed\s+/i, "")
    .replace(/^work performed\s*[:\-]?\s*/i, "")
    .replace(/reset the clutch by moving it to (?:the )?correct position/gi, "reset the clutch to the correct indexed position")
    .replace(/moving the clutch to (?:the )?correct position/gi, "resetting the clutch to the correct indexed position");
  return ensurePeriod(text);
}

export function fallbackGenerate(input) {
  const issue = formatIssue(input.issue, input.machine_name);
  const reason = input.reason ? formatReason(input.reason, input) : null;
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
  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("AI response was not valid JSON");
  }
}

export function enforceGeneratedOutput(output, input) {
  const fallbackIssue = formatIssue(input.issue, input.machine_name);
  let issue = ensurePeriod(output.issue || input.issue);
  if (looksUnhelpfullyVague(issue, input.issue)) {
    issue = fallbackIssue;
  }

  let reason = output.reason ? ensurePeriod(output.reason) : null;
  let workPerformed = output.work_performed ? ensurePeriod(output.work_performed) : null;
  if (input.reason && reason && looksUnhelpfullyVague(reason, input.reason)) reason = formatReason(input.reason, input);
  if (input.work_performed && workPerformed && looksUnhelpfullyVague(workPerformed, input.work_performed)) workPerformed = formatWork(input.work_performed);

  const cleaned = {
    issue,
    reason,
    work_performed: workPerformed,
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
