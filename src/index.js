import {
  detectProhibitedInformation,
  enforceGeneratedOutput,
  fallbackGenerate,
  normalizeWhitespace,
  parseAIResult,
  similarityScore,
} from "./lib.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function authorized(request, env) {
  if (!env.ACCESS_KEY) return true;
  return constantTimeEqual(request.headers.get("X-App-Key"), env.ACCESS_KEY);
}

function requireAuthorized(request, env) {
  return authorized(request, env) ? null : json({ detail: "A valid application access key is required." }, 401);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Response(JSON.stringify({ detail: "Request body must be valid JSON." }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
}

function validateInput(payload) {
  const input = {
    machine_name: normalizeWhitespace(payload.machine_name).slice(0, 120),
    issue: normalizeWhitespace(payload.issue).slice(0, 800),
    reason: normalizeWhitespace(payload.reason).slice(0, 800),
    work_performed: normalizeWhitespace(payload.work_performed).slice(0, 1200),
    result_confirmed: Boolean(payload.result_confirmed),
    result_notes: normalizeWhitespace(payload.result_notes).slice(0, 500),
  };
  if (!input.issue) throw new Response(JSON.stringify({ detail: "Issue is required." }), { status: 422, headers: JSON_HEADERS });

  const prohibited = detectProhibitedInformation(input);
  if (prohibited.length) {
    throw new Response(JSON.stringify({
      detail: {
        message: "Product, quality, patient, customer, lot, batch, recall, or quantity information was detected. Keep this record limited to equipment-maintenance facts.",
        detected_categories: prohibited,
      },
    }), { status: 422, headers: JSON_HEADERS });
  }
  return input;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    issue: { type: "string" },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    work_performed: { anyOf: [{ type: "string" }, { type: "null" }] },
    results: { anyOf: [{ type: "string" }, { type: "null" }] },
    missing_information: { type: "array", items: { type: "string" } },
    prohibited_information_detected: { type: "boolean" },
  },
  required: [
    "issue",
    "reason",
    "work_performed",
    "results",
    "missing_information",
    "prohibited_information_detected",
  ],
  additionalProperties: false,
};

async function generateWithAI(env, input) {
  if (!env.AI) throw new Error("Workers AI binding is not configured");
  const model = env.AI_MODEL || "@cf/zai-org/glm-4.7-flash";
  const system = `You are an industrial maintenance documentation assistant.
Rewrite only the technician-confirmed facts into concise technical maintenance language.
Return Issue, Reason, Work performed, and Results.
Rules:
- Correct spelling and grammar.
- Rewrite vague technician shorthand into clear, manager-friendly technical language.
- Never merely copy a short note such as "bad cables," "bad encoder," "bad sensor," "motor issue," "machine down," or "not working."
- When the Issue contains fewer than eight words, expand it into one or two complete technical sentences.
- The first sentence must state the observed component or machine condition.
- The second sentence may explain the affected technical function only when that function is inherent to the named component or directly supported by the technician's words.
- When only a component and a general failure word are supplied, describe the component's failed or unreliable normal function without inventing a specific root cause.
- Example: "bad cables" becomes "One or more equipment cables were not providing a reliable electrical connection. This created an unstable electrical path within the affected machine circuit."
- Example: "bad encoder" becomes "The encoder was not providing reliable position feedback to the control system. The controller could not consistently verify the associated machine position or movement."
- Improve short Reason and Work performed notes into complete technical sentences, but preserve exactly what was confirmed and never add an action or cause that was not supplied.
- Keep each field to one or two complete sentences.
- Never invent a root cause, repair, test, adjustment, production impact, or successful result.
- If Reason was not supplied, return null.
- If Work performed was not supplied, return null.
- If machine operation was not confirmed, Results must be null.
- Do not mention product names, part/product identifiers, lots, batches, quantities, recalls, rejects, scrap, patients, customers, operators, or quality disposition.
- Use professional equipment-maintenance terminology that a maintenance manager can understand.
- Return only the requested JSON structure.`;

  const user = JSON.stringify({
    machine_or_equipment: input.machine_name || null,
    issue: input.issue,
    confirmed_reason: input.reason || null,
    confirmed_work_performed: input.work_performed || null,
    machine_operation_verified: input.result_confirmed,
    confirmed_result_note: input.result_notes || null,
  });

  const raw = await env.AI.run(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: OUTPUT_SCHEMA,
    },
    temperature: 0.1,
    max_completion_tokens: 500,
  });
  const parsed = parseAIResult(raw);
  parsed.generation_mode = "cloudflare-ai";
  return enforceGeneratedOutput(parsed, input);
}

async function getRecords(env, limit = 12, machineName = "") {
  if (!env.DB) throw new Error("D1 binding is not configured");
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 250);
  const machine = normalizeWhitespace(machineName);
  const baseSelect = `
    SELECT id, machine_name, raw_issue, issue, reason, work_performed, results,
           result_confirmed, selected_count, user_modified, created_at
    FROM maintenance_records
  `;
  const statement = machine
    ? env.DB.prepare(`${baseSelect} WHERE LOWER(TRIM(machine_name)) = LOWER(TRIM(?)) ORDER BY selected_count DESC, datetime(created_at) DESC, id DESC LIMIT ?`).bind(machine, safeLimit)
    : env.DB.prepare(`${baseSelect} ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`).bind(safeLimit);
  const result = await statement.all();
  return result.results || [];
}

async function getMachineTypes(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");
  const result = await env.DB.prepare(`
    SELECT TRIM(machine_name) AS machine_name,
           COUNT(*) AS record_count,
           COALESCE(SUM(selected_count), 0) AS selected_count
    FROM maintenance_records
    WHERE machine_name IS NOT NULL AND TRIM(machine_name) <> ''
    GROUP BY LOWER(TRIM(machine_name))
    ORDER BY record_count DESC, selected_count DESC, machine_name ASC
  `).all();
  return result.results || [];
}

async function handleHealth(env) {
  let storageConfigured = Boolean(env.DB);
  if (storageConfigured) {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
    } catch {
      storageConfigured = false;
    }
  }
  return json({
    status: "ok",
    platform: "cloudflare-workers",
    ai_configured: Boolean(env.AI),
    storage_configured: storageConfigured,
    model: env.AI_MODEL || "@cf/zai-org/glm-4.7-flash",
    access_key_required: Boolean(env.ACCESS_KEY),
  });
}

async function handleGenerate(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  const payload = await readJson(request);
  const input = validateInput(payload);

  let output;
  let aiWarning = null;
  try {
    output = await generateWithAI(env, input);
  } catch (error) {
    output = fallbackGenerate(input);
    aiWarning = "Cloudflare AI was unavailable, so the built-in technical formatter was used.";
    console.warn("AI fallback:", error?.message || error);
  }

  const prohibitedOutput = detectProhibitedInformation(output);
  if (prohibitedOutput.length || output.prohibited_information_detected) {
    return json({
      detail: {
        message: "The generated wording contained restricted product or quality information and was not returned.",
        detected_categories: prohibitedOutput,
      },
    }, 422);
  }

  return json({ ...output, warning: aiWarning });
}

async function handleSuggestions(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  const url = new URL(request.url);
  const query = normalizeWhitespace(url.searchParams.get("q"));
  const machine = normalizeWhitespace(url.searchParams.get("machine_name"));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 5, 1), 20);
  if (query.length < 2 && !machine) return json([]);

  const records = await getRecords(env, 250, machine);
  if (query.length < 2) {
    return json(records.slice(0, limit).map((record) => ({ ...record, score: 100 })));
  }

  const ranked = records
    .map((record) => ({ ...record, score: similarityScore(query, record, machine) }))
    .filter((record) => record.score >= 15)
    .sort((a, b) => b.score - a.score || b.selected_count - a.selected_count || b.id - a.id)
    .slice(0, limit);
  return json(ranked);
}

async function handleListRecords(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  const url = new URL(request.url);
  return json(await getRecords(env, url.searchParams.get("limit"), url.searchParams.get("machine_name")));
}

async function handleMachineTypes(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  return json(await getMachineTypes(env));
}

async function handleCreateRecord(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  if (!env.DB) return json({ detail: "D1 database binding is not configured." }, 503);
  const payload = await readJson(request);

  const record = {
    machine_name: normalizeWhitespace(payload.machine_name).slice(0, 120),
    raw_issue: normalizeWhitespace(payload.raw_issue).slice(0, 800),
    issue: normalizeWhitespace(payload.issue).slice(0, 800),
    reason: normalizeWhitespace(payload.reason).slice(0, 800) || null,
    work_performed: normalizeWhitespace(payload.work_performed).slice(0, 1200) || null,
    results: normalizeWhitespace(payload.results).slice(0, 500) || null,
    result_confirmed: Boolean(payload.result_confirmed),
    selected_record_id: Number(payload.selected_record_id) || null,
    user_modified: Boolean(payload.user_modified),
  };

  if (!record.issue) return json({ detail: "Issue cannot be blank." }, 422);
  if (record.results && !record.result_confirmed) {
    return json({ detail: "Machine operation must be verified before a Results statement can be approved." }, 422);
  }
  const prohibited = detectProhibitedInformation(record);
  if (prohibited.length) {
    return json({ detail: { message: "Restricted product or quality information was detected.", detected_categories: prohibited } }, 422);
  }

  const insert = await env.DB.prepare(`
    INSERT INTO maintenance_records (
      machine_name, raw_issue, issue, reason, work_performed, results,
      result_confirmed, selected_count, user_modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    record.machine_name,
    record.raw_issue,
    record.issue,
    record.reason,
    record.work_performed,
    record.results,
    record.result_confirmed ? 1 : 0,
    record.user_modified ? 1 : 0,
  ).run();

  if (record.selected_record_id) {
    await env.DB.prepare(`
      UPDATE maintenance_records
      SET selected_count = selected_count + 1
      WHERE id = ?
    `).bind(record.selected_record_id).run();
  }

  const saved = await env.DB.prepare(`
    SELECT id, machine_name, raw_issue, issue, reason, work_performed, results,
           result_confirmed, selected_count, user_modified, created_at
    FROM maintenance_records WHERE id = ?
  `).bind(insert.meta.last_row_id).first();
  return json(saved, 201);
}

async function handleExport(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  const records = await getRecords(env, 10000);
  return json({ exported_at: new Date().toISOString(), records }, 200, {
    "content-disposition": `attachment; filename="maintenance-records-${new Date().toISOString().slice(0, 10)}.json"`,
  });
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/api/health" && request.method === "GET") return handleHealth(env);
  if (path === "/api/generate" && request.method === "POST") return handleGenerate(request, env);
  if (path === "/api/suggestions" && request.method === "GET") return handleSuggestions(request, env);
  if (path === "/api/records" && request.method === "GET") return handleListRecords(request, env);
  if (path === "/api/records" && request.method === "POST") return handleCreateRecord(request, env);
  if (path === "/api/machines" && request.method === "GET") return handleMachineTypes(request, env);
  if (path === "/api/export" && request.method === "GET") return handleExport(request, env);
  return json({ detail: "API route not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(error);
      const message = error?.message || "Unexpected server error.";
      const databaseHint = /no such table|D1|database/i.test(message)
        ? " Initialize the D1 database by applying migrations/0001_initial.sql."
        : "";
      return json({ detail: `${message}${databaseHint}` }, 500);
    }
  },
};
