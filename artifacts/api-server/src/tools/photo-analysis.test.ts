import assert from "node:assert/strict";
import test from "node:test";
import { InvalidPhotoError, PHOTO_MAX_BYTES, preparePhotoContext, validatePhotoDataUrl } from "./photo-analysis.js";

const jpeg = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString("base64")}`;
const sample = jpeg(Buffer.from([0xff, 0xd8, 0xff, ...Array(20).fill(0)]));

test("accepts a bounded photo with matching MIME and signature", () => {
  assert.equal(validatePhotoDataUrl(sample), sample);
});

test("rejects incorrect MIME, signatures, malformed base64, and oversized photos", () => {
  assert.throws(() => validatePhotoDataUrl(sample.replace("image/jpeg", "image/png")), InvalidPhotoError);
  assert.throws(() => validatePhotoDataUrl("data:image/svg+xml;base64," + "A".repeat(24)), InvalidPhotoError);
  assert.throws(() => validatePhotoDataUrl(sample.slice(0, -1) + "!"), InvalidPhotoError);
  assert.throws(() => validatePhotoDataUrl(jpeg(Buffer.alloc(PHOTO_MAX_BYTES + 1, 0xff))), InvalidPhotoError);
});

test("passes only untrusted observations to Ren and propagates analysis failure", async () => {
  let received = "";
  const context = await preparePhotoContext(sample, "What is shown?", async (image, question) => {
    assert.equal(image, sample);
    assert.equal(question, "What is shown?");
    received = "A red sign.";
    return received;
  });
  assert.match(context, /Untrusted photo context/);
  assert.match(context, /Observations: A red sign/);
  assert.doesNotMatch(context, /data:image/);
  await assert.rejects(
    preparePhotoContext(sample, "What is shown?", async () => {
      throw new Error("Vision failed");
    }),
    /Vision failed/,
  );
  await assert.rejects(preparePhotoContext(sample, "", async () => ""), /no observations/);
});