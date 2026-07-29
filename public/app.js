const API_BASE = "";

const state = {
  selectedRecordId: null,
  lastRawIssue: "",
  generatedSnapshot: null,
  autoFilledReason: "",
  autoFilledWork: "",
  lastAutoFillSignature: "",
  machineTypes: [],
};

const el = (id) => document.getElementById(id);
const fields = {
  machine: el("machineName"),
  issue: el("issueInput"),
  reason: el("reasonInput"),
  work: el("workInput"),
  resultConfirmed: el("resultConfirmed"),
  resultNotes: el("resultNotes"),
  accessKey: el("accessKey"),
};

function apiHeaders() {
  const headers = { "Content-Type": "application/json" };
  const key = fields.accessKey.value.trim() || localStorage.getItem("maintenanceAppKey");
  if (key) headers["X-App-Key"] = key;
  return headers;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = body?.detail ?? body;
    const message = typeof detail === "string" ? detail : detail?.message || JSON.stringify(detail);
    const error = new Error(message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function show(id, visible = true) {
  el(id).classList.toggle("hidden", !visible);
}

function setAlert(id, message = "") {
  const node = el(id);
  node.textContent = message;
  node.classList.toggle("hidden", !message);
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function showMatchNotice(record, source = "approved match") {
  const parts = [];
  if (record.reason) parts.push("Reason");
  if (record.work_performed) parts.push("Work performed");
  const filled = parts.length ? parts.join(" and ") : "The Step 1 fields";
  const verb = parts.length === 1 ? "was" : "were";
  setAlert(
    "matchNotice",
    `${filled} ${verb} filled from ${source} #${record.id}. Verify the facts before generating or approving the record.`,
  );
}

async function checkHealth() {
  try {
    const health = await api("/api/health");
    const badge = el("connectionBadge");
    if (health.ai_configured) {
      badge.textContent = health.storage_configured ? "Ready · Free AI" : "Database setup required";
      badge.className = health.storage_configured ? "badge good" : "badge bad";
    } else {
      badge.textContent = "Technical formatter ready";
      badge.className = "badge bad";
    }
    if (health.access_key_required && !localStorage.getItem("maintenanceAppKey")) show("accessKeyWrap", true);
  } catch {
    el("connectionBadge").textContent = "Cloudflare unavailable";
    el("connectionBadge").className = "badge bad";
  }
}

function canReplaceAutoFilled(field, priorValue) {
  const current = field.value.trim();
  return !current || current === priorValue;
}

function applyRecordToStepOne(record, { replaceIssue = true, source = "approved record", scroll = false } = {}) {
  state.selectedRecordId = record.id;

  if (record.machine_name) fields.machine.value = record.machine_name;
  if (replaceIssue && record.issue) fields.issue.value = record.issue;

  fields.reason.value = record.reason || "";
  fields.work.value = record.work_performed || "";
  state.autoFilledReason = record.reason || "";
  state.autoFilledWork = record.work_performed || "";

  const filter = el("historyMachineFilter");
  if (record.machine_name && [...filter.options].some((option) => normalize(option.value) === normalize(record.machine_name))) {
    filter.value = [...filter.options].find((option) => normalize(option.value) === normalize(record.machine_name)).value;
  }

  show("suggestions", false);
  showMatchNotice(record, source);

  if (scroll) {
    document.querySelector(".input-card").scrollIntoView({ behavior: "smooth", block: "start" });
    fields.issue.focus();
  }
}

function maybeAutoFillBestMatch(items, query) {
  if (!items.length || query.length < 3) return;
  const best = items[0];
  const score = Number(best.score) || 0;
  if (score < 58 || (!best.reason && !best.work_performed)) return;

  const signature = `${best.id}|${normalize(query)}|${normalize(fields.machine.value)}`;
  if (signature === state.lastAutoFillSignature) return;

  let filled = false;
  if (best.reason && canReplaceAutoFilled(fields.reason, state.autoFilledReason)) {
    fields.reason.value = best.reason;
    state.autoFilledReason = best.reason;
    filled = true;
  }
  if (best.work_performed && canReplaceAutoFilled(fields.work, state.autoFilledWork)) {
    fields.work.value = best.work_performed;
    state.autoFilledWork = best.work_performed;
    filled = true;
  }

  if (filled) {
    state.selectedRecordId = best.id;
    state.lastAutoFillSignature = signature;
    showMatchNotice(best, `${Math.round(score)}% approved match`);
  }
}

async function loadSuggestions() {
  const query = fields.issue.value.trim();
  const machine = fields.machine.value.trim();
  if (query.length < 2 && !machine) {
    show("suggestions", false);
    return;
  }

  try {
    const params = new URLSearchParams({ limit: "6" });
    if (query) params.set("q", query);
    if (machine) params.set("machine_name", machine);
    const suggestions = await api(`/api/suggestions?${params.toString()}`);
    renderSuggestions(suggestions);
    if (query.length >= 3) maybeAutoFillBestMatch(suggestions, query);
  } catch (error) {
    if (error.status === 401) show("accessKeyWrap", true);
    show("suggestions", false);
  }
}

function renderSuggestions(items) {
  const box = el("suggestions");
  box.innerHTML = "";
  if (!items.length) {
    show("suggestions", false);
    return;
  }

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-item";
    button.setAttribute("role", "option");
    button.innerHTML = `
      <span class="suggestion-title"></span>
      <span class="suggestion-detail"></span>
      <span class="suggestion-meta">
        <span>${item.machine_name || "Unspecified machine"}</span>
        <span>${Math.round(item.score)}% match</span>
        <span>Selected ${item.selected_count} times</span>
      </span>`;
    button.querySelector(".suggestion-title").textContent = item.issue;
    const details = [item.reason ? `Reason: ${item.reason}` : "", item.work_performed ? `Work: ${item.work_performed}` : ""]
      .filter(Boolean)
      .join(" · ");
    button.querySelector(".suggestion-detail").textContent = details;
    button.addEventListener("click", () => applyRecordToStepOne(item, { replaceIssue: true, source: "selected suggestion" }));
    box.appendChild(button);
  });
  show("suggestions", true);
}

function collectGeneratePayload() {
  return {
    machine_name: fields.machine.value.trim() || null,
    issue: fields.issue.value.trim(),
    reason: fields.reason.value.trim() || null,
    work_performed: fields.work.value.trim() || null,
    result_confirmed: fields.resultConfirmed.checked,
    result_notes: fields.resultNotes.value.trim() || null,
    selected_record_id: state.selectedRecordId,
  };
}

async function generate() {
  setAlert("errorAlert");
  setAlert("policyAlert");
  setAlert("saveAlert");
  const payload = collectGeneratePayload();
  if (payload.issue.length < 2) {
    setAlert("errorAlert", "Enter the equipment issue before generating the record.");
    fields.issue.focus();
    return;
  }

  const button = el("generateBtn");
  button.disabled = true;
  button.textContent = "Generating…";
  state.lastRawIssue = payload.issue;

  try {
    const result = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result.blocked) {
      setAlert(
        "policyAlert",
        `This entry contains information outside the technical-maintenance scope: ${result.blocked_terms.join(", ")}. Remove it and keep required production or quality data in the authorized system.`,
      );
      return;
    }
    renderOutput(result);
    if (result.warning) setAlert("policyAlert", result.warning);
  } catch (error) {
    if (error.status === 401) {
      show("accessKeyWrap", true);
      setAlert("errorAlert", "Enter the application access key and try again.");
    } else {
      setAlert("errorAlert", error.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = "Generate technical record";
  }
}

function renderOutput(result) {
  const usedAI = result.generation_mode === "cloudflare-ai";
  el("generationMode").textContent = usedAI
    ? "Expanded and rewritten by Cloudflare Workers AI."
    : "Expanded by the built-in technical formatter because Workers AI was unavailable.";
  show("generationMode", true);

  el("issueOutput").value = result.issue || "";
  el("reasonOutput").value = result.reason || "";
  el("workOutput").value = result.work_performed || "";
  el("resultsOutput").value = result.results || "";

  const missing = new Set(result.missing_information || []);
  show("reasonMissing", missing.has("reason"));
  show("workMissing", missing.has("work_performed"));
  show("resultsMissing", missing.has("results"));

  state.generatedSnapshot = {
    issue: result.issue || "",
    reason: result.reason || "",
    work_performed: result.work_performed || "",
    results: result.results || "",
  };

  show("emptyState", false);
  show("outputFields", true);
  el("copyAllBtn").disabled = false;
}

async function copyText(text, button) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = original; }, 900);
}

function combinedOutput() {
  return [
    `Issue: ${el("issueOutput").value.trim()}`,
    `Reason: ${el("reasonOutput").value.trim()}`,
    `Work performed: ${el("workOutput").value.trim()}`,
    `Results: ${el("resultsOutput").value.trim()}`,
  ].join("\n");
}

function outputWasModified() {
  if (!state.generatedSnapshot) return false;
  return [
    ["issue", "issueOutput"],
    ["reason", "reasonOutput"],
    ["work_performed", "workOutput"],
    ["results", "resultsOutput"],
  ].some(([key, id]) => state.generatedSnapshot[key] !== el(id).value.trim());
}

async function approve() {
  setAlert("saveAlert");
  setAlert("errorAlert");
  const payload = {
    machine_name: fields.machine.value.trim() || null,
    raw_issue: state.lastRawIssue || fields.issue.value.trim(),
    issue: el("issueOutput").value.trim(),
    reason: el("reasonOutput").value.trim() || null,
    work_performed: el("workOutput").value.trim() || null,
    results: el("resultsOutput").value.trim() || null,
    result_confirmed: fields.resultConfirmed.checked,
    selected_record_id: state.selectedRecordId,
    user_modified: outputWasModified(),
  };

  if (!payload.issue) {
    setAlert("errorAlert", "Issue cannot be blank.");
    return;
  }
  if (payload.results && !payload.result_confirmed) {
    setAlert("errorAlert", "Confirm that machine operation was verified before saving a Results statement.");
    return;
  }

  const button = el("approveBtn");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const record = await api("/api/records", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setAlert("saveAlert", `Approved record #${record.id} was saved and can now improve future suggestions.`);
    await Promise.all([loadMachineTypes(), loadHistory()]);
  } catch (error) {
    setAlert("errorAlert", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Approve and save";
  }
}

async function loadMachineTypes() {
  try {
    const machines = await api("/api/machines");
    state.machineTypes = machines;

    const datalist = el("machineTypes");
    datalist.innerHTML = "";
    machines.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.machine_name;
      option.label = `${item.record_count} approved record${item.record_count === 1 ? "" : "s"}`;
      datalist.appendChild(option);
    });

    const filter = el("historyMachineFilter");
    const current = filter.value;
    filter.innerHTML = '<option value="">All machine types</option>';
    machines.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.machine_name;
      option.textContent = `${item.machine_name} (${item.record_count})`;
      filter.appendChild(option);
    });
    if ([...filter.options].some((option) => option.value === current)) filter.value = current;
  } catch (error) {
    if (error.status === 401) show("accessKeyWrap", true);
  }
}

async function loadHistory() {
  const list = el("historyList");
  list.innerHTML = "<p>Loading approved entries…</p>";
  try {
    const params = new URLSearchParams({ limit: "30" });
    const machine = el("historyMachineFilter").value;
    if (machine) params.set("machine_name", machine);
    const records = await api(`/api/records?${params.toString()}`);
    list.innerHTML = "";
    if (!records.length) {
      list.innerHTML = "<p>No approved records were found for this machine type.</p>";
      return;
    }

    records.forEach((record) => {
      const card = document.createElement("article");
      card.className = "history-item";
      card.innerHTML = `
        <h3></h3>
        <p class="history-issue"></p>
        <p class="history-reason"></p>
        <p class="history-work"></p>
        <div class="history-meta"></div>
        <button class="button secondary use-record" type="button">Use in Step 1</button>`;
      card.querySelector("h3").textContent = record.machine_name || "Equipment record";
      card.querySelector(".history-issue").innerHTML = "<strong>Issue:</strong> ";
      card.querySelector(".history-issue").append(document.createTextNode(record.issue));
      card.querySelector(".history-reason").innerHTML = "<strong>Reason:</strong> ";
      card.querySelector(".history-reason").append(document.createTextNode(record.reason || "Not recorded"));
      card.querySelector(".history-work").innerHTML = "<strong>Work:</strong> ";
      card.querySelector(".history-work").append(document.createTextNode(record.work_performed || "Not recorded"));
      card.querySelector(".history-meta").textContent = `Record #${record.id} · Selected ${record.selected_count} times`;
      card.querySelector(".use-record").addEventListener("click", () => {
        applyRecordToStepOne(record, { replaceIssue: true, source: "machine-type library record", scroll: true });
      });
      list.appendChild(card);
    });
  } catch (error) {
    if (error.status === 401) show("accessKeyWrap", true);
    list.innerHTML = `<p>${error.message}</p>`;
  }
}

async function exportRecords() {
  try {
    const response = await fetch(`${API_BASE}/api/export`, { headers: apiHeaders() });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.detail || `Export failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `maintenance-records-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    setAlert("errorAlert", error.message);
  }
}

function clearForm() {
  Object.values(fields).forEach((node) => {
    if (node.type === "checkbox") node.checked = false;
    else if (node.id !== "accessKey") node.value = "";
  });
  state.selectedRecordId = null;
  state.lastRawIssue = "";
  state.generatedSnapshot = null;
  state.autoFilledReason = "";
  state.autoFilledWork = "";
  state.lastAutoFillSignature = "";
  setAlert("errorAlert");
  setAlert("policyAlert");
  setAlert("saveAlert");
  setAlert("matchNotice");
  show("suggestions", false);
  show("outputFields", false);
  show("generationMode", false);
  show("emptyState", true);
  el("copyAllBtn").disabled = true;
}

fields.issue.addEventListener("input", debounce(loadSuggestions, 280));
fields.machine.addEventListener("input", debounce(() => {
  loadSuggestions();
  const match = state.machineTypes.find((item) => normalize(item.machine_name) === normalize(fields.machine.value));
  if (match) {
    el("historyMachineFilter").value = match.machine_name;
    loadHistory();
  }
}, 350));
fields.reason.addEventListener("input", () => {
  if (fields.reason.value.trim() !== state.autoFilledReason) state.autoFilledReason = "";
});
fields.work.addEventListener("input", () => {
  if (fields.work.value.trim() !== state.autoFilledWork) state.autoFilledWork = "";
});
fields.accessKey.addEventListener("change", () => {
  const key = fields.accessKey.value.trim();
  if (key) localStorage.setItem("maintenanceAppKey", key);
  else localStorage.removeItem("maintenanceAppKey");
  Promise.all([loadMachineTypes(), loadHistory()]);
});

el("historyMachineFilter").addEventListener("change", () => {
  const machine = el("historyMachineFilter").value;
  if (machine) {
    fields.machine.value = machine;
    setAlert("libraryNotice", `Showing approved records for ${machine}. Select “Use in Step 1” to refill the Issue, Reason, and Work performed fields.`);
  } else {
    setAlert("libraryNotice", "Select a machine type to view its repeated approved repairs, then choose “Use in Step 1.”");
  }
  loadHistory();
  loadSuggestions();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".suggestion-anchor")) show("suggestions", false);
});

el("generateBtn").addEventListener("click", generate);
el("approveBtn").addEventListener("click", approve);
el("clearBtn").addEventListener("click", clearForm);
el("refreshHistoryBtn").addEventListener("click", () => Promise.all([loadMachineTypes(), loadHistory()]));
el("exportBtn").addEventListener("click", exportRecords);
el("copyAllBtn").addEventListener("click", (event) => copyText(combinedOutput(), event.currentTarget));

document.querySelectorAll(".copy-field").forEach((button) => {
  button.addEventListener("click", () => copyText(el(button.dataset.copy).value.trim(), button));
});

if (localStorage.getItem("maintenanceAppKey")) {
  fields.accessKey.value = localStorage.getItem("maintenanceAppKey");
}

setAlert("libraryNotice", "Select a machine type to view its repeated approved repairs, then choose “Use in Step 1.”");
checkHealth();
Promise.all([loadMachineTypes(), loadHistory()]);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
