import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOpenAIConsultation,
  extractExplicitOpenAIQuestion,
} from "./openai-consultation-policy.js";

test("recommends consultation only for clear technical diagnosis and source synthesis", () => {
  assert.deepEqual(
    assessOpenAIConsultation({
      message: "Diagnose why this API integration keeps timing out during OAuth.",
      explicitRequest: false,
      localToolHandled: false,
      webResultCount: 0,
    }),
    { decision: "recommend", reason: "technical_diagnosis" },
  );
  assert.deepEqual(
    assessOpenAIConsultation({
      message: "Cross-check these sources and reconcile their claims.",
      explicitRequest: false,
      localToolHandled: false,
      webResultCount: 0,
    }),
    { decision: "recommend", reason: "multi_source_synthesis" },
  );
  assert.deepEqual(
    assessOpenAIConsultation({
      message: "Compare these findings.",
      explicitRequest: false,
      localToolHandled: false,
      webResultCount: 2,
    }),
    { decision: "recommend", reason: "multi_source_synthesis" },
  );
});

test("does not recommend routine questions or tasks already handled by local tools", () => {
  assert.deepEqual(
    assessOpenAIConsultation({
      message: "What is the capital of France?",
      explicitRequest: false,
      localToolHandled: false,
      webResultCount: 0,
    }),
    { decision: "skip", reason: "no_clear_need" },
  );
  assert.deepEqual(
    assessOpenAIConsultation({
      message: "Diagnose why this API request is timing out.",
      explicitRequest: false,
      localToolHandled: true,
      webResultCount: 0,
    }),
    { decision: "skip", reason: "local_tool_handled" },
  );
  assert.deepEqual(
    assessOpenAIConsultation({
      message: "Ask OpenAI: explain this error",
      explicitRequest: true,
      localToolHandled: false,
      webResultCount: 0,
    }),
    { decision: "explicit_request", reason: "handled_by_explicit_tool" },
  );
});

test("extracts only explicit OpenAI requests and their tasks", () => {
  assert.equal(extractExplicitOpenAIQuestion("Ask OpenAI: explain this error"), "explain this error");
  assert.equal(extractExplicitOpenAIQuestion("Ren, could you please ask OpenAI what causes tides?"), "what causes tides?");
  assert.equal(extractExplicitOpenAIQuestion("Hey, Lumen, can you ask OpenAI: what causes tides?"), "what causes tides?");
  assert.equal(extractExplicitOpenAIQuestion("I want you to ask OpenAI: compare these plans"), "compare these plans");
  assert.equal(extractExplicitOpenAIQuestion("Please consult with OpenAI on this plan"), "on this plan");
  assert.equal(
    extractExplicitOpenAIQuestion("Ren, ask OpenAI to give you three approaches. Then pick the one you like and explain it to me."),
    "to give you three approaches",
  );
  assert.equal(extractExplicitOpenAIQuestion("What causes tides? Please ask OpenAI."), "What causes tides?");
  assert.equal(extractExplicitOpenAIQuestion("Ask ChatGPT: tell me a joke"), "tell me a joke");
  assert.equal(extractExplicitOpenAIQuestion("Ask OpenAI"), "");
});

test("does not route technical topics or mentions of OpenAI automatically", () => {
  for (const content of [
    "Diagnose why this API integration keeps timing out during OAuth.",
    "Cross-check these sources and reconcile their claims.",
    "Tell me about OpenAI.",
    "I might ask OpenAI later.",
    "Do not ask OpenAI about this.",
    "What happens if I ask OpenAI a question?",
    "Hello Ren, how are you?",
  ]) {
    assert.equal(extractExplicitOpenAIQuestion(content), null, content);
  }
});