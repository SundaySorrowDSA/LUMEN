import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutomaticallyConsultOpenAI } from "./openai-consultation-policy.js";

const decide = (
  message: string,
  options: { localToolHandled?: boolean; hasWebResults?: boolean } = {},
) => shouldAutomaticallyConsultOpenAI({
  message,
  localToolHandled: options.localToolHandled ?? false,
  hasWebResults: options.hasWebResults ?? false,
});

test("automatically consults for concrete technical troubleshooting", () => {
  assert.equal(
    decide("Diagnose why this API integration keeps timing out during OAuth."),
    true,
  );
  assert.equal(
    decide("Help me debug this race condition and failing tests."),
    true,
  );
});

test("automatically consults for explicit synthesis when web results exist", () => {
  assert.equal(
    decide("Cross-check the current reports and reconcile what the sources disagree on.", {
      hasWebResults: true,
    }),
    true,
  );
});

test("does not consult for generic analysis words or ordinary conversation", () => {
  const messages = [
    "Analyze how my day went.",
    "Compare how we each handled that relationship discussion.",
    "Can you reason through my feelings with me?",
    "Hello Ren, how are you?",
    "Write a playful roleplay scene for us.",
    "What is an API?",
    "Compare these two dinner ideas.",
    "Ask ChatGPT: tell me a joke.",
  ];
  for (const message of messages) {
    assert.equal(decide(message), false, message);
  }
});

test("does not synthesize without successful web results", () => {
  assert.equal(
    decide("Cross-check the current reports and reconcile what the sources disagree on."),
    false,
  );
});

test("local tool handling vetoes automatic consultation", () => {
  assert.equal(
    decide("Diagnose why this API request timed out.", { localToolHandled: true }),
    false,
  );
  assert.equal(
    decide("Compare the sources and assess the evidence.", {
      localToolHandled: true,
      hasWebResults: true,
    }),
    false,
  );
});