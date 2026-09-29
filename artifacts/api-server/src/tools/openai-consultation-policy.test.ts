import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitOpenAIQuestion } from "./openai-consultation-policy.js";

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