import test from "node:test";
import assert from "node:assert/strict";
import {
  detectProhibitedInformation,
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
