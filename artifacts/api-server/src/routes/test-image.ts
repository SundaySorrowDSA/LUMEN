import { Router, type IRouter } from "express";
import { GenerateTestImageBody } from "@workspace/api-zod";
import {
  generateTestImage,
  TEST_IMAGE_MODEL,
  TEST_IMAGE_PROMPT,
  TestImageError,
} from "../lib/test-image-generation.js";

const TEST_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>LUMEN — isolated image test</title>
<style>
body{font:16px system-ui,sans-serif;background:#191a1c;color:#eee;max-width:800px;margin:40px auto;padding:20px}
button{background:#e9b52b;color:#191a1c;border:0;border-radius:8px;padding:14px 20px;font:inherit;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}img{display:block;max-width:100%;height:auto;margin-top:24px;border-radius:8px}
img[hidden]{display:none}
small{color:#b9b9b9}#status{min-height:24px}
textarea{box-sizing:border-box;width:100%;margin:8px 0 16px;padding:10px;font:inherit;border:1px solid #666;border-radius:8px;background:#252629;color:#eee}
</style></head><body>
<h1>LUMEN image test</h1>
<label for="prompt">Image prompt</label>
<textarea id="prompt" rows="3">${TEST_IMAGE_PROMPT}</textarea>
<p><small>Model: ${TEST_IMAGE_MODEL}. This test does not use Ren, save to chat, or store the image.</small></p>
<button id="generate" type="button">Generate one image</button>
<p id="status" role="status" aria-live="polite">Click the button to send one request to OpenAI.</p>
<img id="image" alt="Generated test image" hidden>
<script>
const button = document.getElementById("generate");
const status = document.getElementById("status");
const image = document.getElementById("image");
const promptField = document.getElementById("prompt");
let imageUrl;
button.addEventListener("click", async () => {
  const prompt = promptField.value.trim();
  if (!prompt) {
    status.textContent = "Please enter a non-empty image prompt.";
    return;
  }
  button.disabled = true;
  promptField.disabled = true;
  status.textContent = "Generating one image… This may take up to two minutes.";
  try {
    const response = await fetch(location.pathname, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({prompt}),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Image generation failed.");
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(await response.blob());
    image.src = imageUrl;
    image.alt = "Generated test image: " + prompt;
    image.hidden = false;
    status.textContent = "One image generated. It is not saved to a conversation.";
  } catch (error) {
    status.textContent = error.message || "The image test failed.";
  } finally {
    button.disabled = false;
    promptField.disabled = false;
  }
});
</script></body></html>`;

export function createTestImageRouter(options: {
  getApiKey?: () => string | undefined;
  fetcher?: typeof fetch;
} = {}): IRouter {
  const router: IRouter = Router();
  let generating = false;
  router.get("/test-image", (_req, res): void => {
    res.set("Cache-Control", "no-store").type("html").send(TEST_PAGE);
  });
  router.post("/test-image", async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const parsed = GenerateTestImageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Prompt must be a non-empty string. Send JSON like { \"prompt\": \"A description of your image\" }." });
      return;
    }
    const apiKey = (options.getApiKey ?? (() => process.env.OPENAI_API_KEY))();
    if (!apiKey) {
      res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server." });
      return;
    }
    if (generating) {
      res.status(429).json({ error: "An image test is already running. Wait for it to finish." });
      return;
    }
    generating = true;
    try {
      const image = await generateTestImage(apiKey, parsed.data.prompt.trim(), options.fetcher);
      req.log.info(
        { stage: "test_image_completed", model: TEST_IMAGE_MODEL, imageCount: 1, imageBytes: image.length },
        "Isolated OpenAI image test completed",
      );
      res.set("Content-Disposition", 'inline; filename="lumen-image-test.png"')
        .type("png").send(image);
    } catch (error) {
      const failure = error instanceof TestImageError
        ? error
        : new TestImageError(502, "Image generation failed.");
      req.log.warn(
        { stage: "test_image_failed", model: TEST_IMAGE_MODEL, status: failure.status, upstreamStatus: failure.upstreamStatus },
        "Isolated OpenAI image test failed",
      );
      res.status(failure.status).json({ error: failure.message });
    } finally {
      generating = false;
    }
  });
  return router;
}

export default createTestImageRouter();
