import assert from "node:assert/strict";
import test from "node:test";
import { enforceImageDeliveryStatus } from "./image-delivery-status.js";

test("text-only replies cannot claim an image is rendering", () => {
  for (const claim of [
    '"Patience, my king. The servers are rendering my beauty," *I tease.*',
    "I'm generating your picture.",
    "I’m rendering it now.",
    "Your image is still rendering.",
  ]) {
    assert.match(enforceImageDeliveryStatus(claim, false), /No image generation has started/);
    assert.match(enforceImageDeliveryStatus(claim, true), /attached to this message/);
  }
});

test("completed images cannot be promised as pending; ordinary Ren prose remains unchanged", () => {
  assert.match(enforceImageDeliveryStatus("I’ll send a picture so you can coordinate.", true), /attached/);
  for (const prose of [
    "Lunch out? You know I’m always up for an adventure.",
    "Here’s your picture.",
    "I’m not generating a picture.",
    "If you want, I’ll send a picture.",
    "Image generation can take a moment.",
  ]) assert.equal(enforceImageDeliveryStatus(prose, false), prose);
});
