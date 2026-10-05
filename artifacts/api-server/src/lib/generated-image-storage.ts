import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

// Replit App Storage sidecar credentials, using the supplied storage template configuration.
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function generatedFile(objectPath: string) {
  if (!/^\/objects\/generated\/[a-f0-9-]+\.png$/.test(objectPath)) throw new Error("Invalid generated image path");
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("App Storage is not configured");
  const fullPath = `${directory.replace(/\/$/, "")}/${objectPath.replace("/objects/", "")}`;
  const [bucket, ...name] = fullPath.replace(/^\//, "").split("/");
  return objectStorageClient.bucket(bucket).file(name.join("/"));
}

export async function saveGeneratedImage(bytes: Buffer): Promise<string> {
  const objectPath = `/objects/generated/${randomUUID()}.png`;
  await generatedFile(objectPath).save(bytes, { resumable: false, contentType: "image/png" });
  return objectPath;
}

export async function readGeneratedImage(objectPath: string): Promise<Buffer> {
  const [bytes] = await generatedFile(objectPath).download();
  return bytes;
}

export async function deleteGeneratedImage(objectPath: string): Promise<void> {
  await generatedFile(objectPath).delete({ ignoreNotFound: true });
}
