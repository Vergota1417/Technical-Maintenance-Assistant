import test from "node:test";
import assert from "node:assert/strict";
import {
  detectProhibitedInformation,
  expandVagueIssue,
  enforceGeneratedOutput,
  fallbackGenerate,
  parseAIResult,
  similarityScore,
} from "../src/lib.js";

test("fallback formatter corrects the sample maintenance entry", () => {
  const result = fallbackGenerate({
    issue: "index machine losts on sleeving",
    reason: "jam on sleeving nest",
    work_performed: "reset the clutch by moving it to correct location",
    result_confirmed: true,
    result_notes: "",
  });
  assert.equal(result.issue, "Indexing machine lost position during the sleeving operation.");
  assert.equal(result.reason, "A jam was present at the sleeving nest.");
  assert.equal(result.work_performed, "Reset the clutch to the correct indexed position.");
  assert.equal(result.results, "Machine is running as intended.");
});

test("unconfirmed results remain blank", () => {
  const result = fallbackGenerate({
    issue: "photoeye not detecting target",
    reason: "",
    work_performed: "cleaned photoeye lens",
    result_confirmed: false,
    result_notes: "",
  });
  assert.equal(result.results, null);
  assert.ok(result.missing_information.includes("results"));
});

test("guardrail detects lot and recall information", () => {
  const matches = detectProhibitedInformation({ issue: "Lot 123 was involved in a recall" });
  assert.ok(matches.includes("lot or batch information"));
  assert.ok(matches.includes("recall information"));
});

test("similar approved issues receive a stronger score", () => {
  const matching = similarityScore(
    "index lost position sleeving",
    { issue: "Indexing machine lost position during sleeving", raw_issue: "", machine_name: "Indexing machine" },
    "Indexing machine",
  );
  const unrelated = similarityScore(
    "index lost position sleeving",
    { issue: "Conveyor motor overload fault", raw_issue: "", machine_name: "Conveyor" },
    "Indexing machine",
  );
  assert.ok(matching > unrelated);
  assert.ok(matching >= 50);
});

test("AI result parser supports Workers AI response shape", () => {
  const parsed = parseAIResult({ response: '{"issue":"Test.","reason":null,"work_performed":null,"results":null,"missing_information":[],"prohibited_information_detected":false}' });
  assert.equal(parsed.issue, "Test.");
});

test("output enforcement does not allow invented fields", () => {
  const output = enforceGeneratedOutput({
    issue: "Machine fault",
    reason: "Invented reason",
    work_performed: "Invented repair",
    results: "Machine is running",
  }, {
    issue: "machine fault",
    reason: "",
    work_performed: "",
    result_confirmed: false,
  });
  assert.equal(output.reason, null);
  assert.equal(output.work_performed, null);
  assert.equal(output.results, null);
});


test("vague cable shorthand becomes manager-friendly technical language", () => {
  const result = fallbackGenerate({
    machine_name: "Indexing machine",
    issue: "bad cables",
    reason: "",
    work_performed: "",
    result_confirmed: false,
    result_notes: "",
  });
  assert.equal(result.issue, "One or more equipment cables were not providing a reliable electrical connection. This created an unstable electrical path within the affected machine circuit.");
});

test("vague encoder shorthand describes the failed function", () => {
  assert.equal(
    expandVagueIssue("bad encoder"),
    "The encoder was not providing reliable position feedback to the control system. The controller could not consistently verify the associated machine position or movement.",
  );
});

test("weak AI wording is replaced by the safe technical expansion", () => {
  const output = enforceGeneratedOutput({
    issue: "Bad cables.",
    reason: null,
    work_performed: null,
    results: null,
    missing_information: [],
    prohibited_information_detected: false,
  }, {
    machine_name: "Indexing machine",
    issue: "bad cables",
    reason: "",
    work_performed: "",
    result_confirmed: false,
  });
  assert.equal(output.issue, "One or more equipment cables were not providing a reliable electrical connection. This created an unstable electrical path within the affected machine circuit.");
});


test("short machine issue expands to two manager-friendly sentences", () => {
  const result = fallbackGenerate({
    machine_name: "Sleeving machine",
    issue: "belt off",
    reason: "",
    work_performed: "",
    result_confirmed: false,
    result_notes: "",
  });
  assert.match(result.issue, /^Sleeving machine experienced the reported belt off condition\./);
  assert.match(result.issue, /associated machine function\.$/);
});

test("short confirmed reason and work are expanded without adding unknown fields", () => {
  const result = fallbackGenerate({
    machine_name: "Indexing machine",
    issue: "encoder fault",
    reason: "loose cable",
    work_performed: "replaced encoder",
    result_confirmed: false,
    result_notes: "",
  });
  assert.equal(result.reason, "A loose electrical connection caused an intermittent signal or power path.");
  assert.equal(result.work_performed, "Removed the failed encoder and installed a replacement unit.");
  assert.equal(result.results, null);
});
