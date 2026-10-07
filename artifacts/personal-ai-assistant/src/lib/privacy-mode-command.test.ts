import test from "node:test";
import assert from "node:assert/strict";
import { privacyModeCommand } from "./privacy-mode-command.ts";

test("recognized privacy phrases map to explicit state changes", () => {
  assert.equal(privacyModeCommand("Dark Mode"), true);
  assert.equal(privacyModeCommand("Hey Lumen, go dark please."), true);
  assert.equal(privacyModeCommand("All Clear"), false);
  assert.equal(privacyModeCommand("Resume notifications!"), false);
});

test("ordinary conversation that mentions privacy mode is not intercepted", () => {
  assert.equal(privacyModeCommand("Can we talk about Dark Mode?"), null);
  assert.equal(privacyModeCommand(""), null);
});
