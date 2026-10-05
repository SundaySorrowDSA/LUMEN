/**
 * Explicit one-time development maintenance. Never run on startup or during Publish.
 * Usage: pnpm --filter @workspace/api-server exec tsx src/maintenance/consolidate-ren-threads.ts --copy
 * Then --verify; only after successful verification, --archive.
 */
import { pool } from "@workspace/db";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { planConsolidation, messageFingerprint, readMessageMetadata, type MigrationMessage } from "../lib/ren-thread-consolidation.js";

const directory = resolve(import.meta.dirname, "../../../../.local/backups");
const reportPath = resolve(directory, "ren-thread-consolidation-report.json");
const sourceTitles = ["Ren feminine identity verification", "Live consult_openai trace check", "Image Capability Verification"];
type Thread = { id: number; title: string; archived_at: string | null };
type Mapping = { sourceId: number; destinationId: number; sourceConversationId: number; hasImage: boolean };
type Report = {
  canonicalId: number; before: { title: string; id: number; messages: number; images: number; photos: number }[];
  migratedMessages: number; migratedImages: number; duplicates: number; mappings: Mapping[];
  expectedCanonicalMessages: number; expectedCanonicalImages: number;
  verified?: boolean; archived?: boolean; imageChecks?: Array<{ messageId: number; bytes: number; sha256: string }>;
};

async function readThreads() {
  const result = await pool.query("SELECT to_jsonb(c) AS record FROM assistant_conversations c ORDER BY id");
  const threads = result.rows.map((row) => row.record as Thread);
  const canonical = threads.filter((thread) => thread.title === "A place to think");
  if (canonical.length !== 1 || canonical[0].archived_at) throw new Error("Expected exactly one active canonical thread.");
  const sources = sourceTitles.map((title) => {
    const matching = threads.filter((thread) => thread.title === title);
    if (matching.length !== 1) throw new Error(`Expected one source thread: ${title}`);
    return matching[0];
  });
  return { canonical: canonical[0], sources };
}

async function copy() {
  // A pre-schema backup is mandatory. No credential or message content is printed.
  await readFile(resolve(directory, "ren-threads-before-consolidation.json"));
  const { canonical, sources } = await readThreads();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE assistant_conversations, assistant_messages IN SHARE ROW EXCLUSIVE MODE");
    const snapshot = await client.query(`SELECT jsonb_build_object(
      'conversations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM assistant_conversations c),
      'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM assistant_messages m),
      'memory',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM assistant_memory n),
      'providerSettings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM assistant_provider_settings s)
    ) AS snapshot`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockedBackup = resolve(directory, `ren-threads-locked-${Date.now()}.json`);
    await writeFile(lockedBackup, JSON.stringify(snapshot.rows[0].snapshot, null, 2), { flag: "wx", mode: 0o600 });
    const messages = snapshot.rows[0].snapshot.messages as MigrationMessage[];
    const destination = messages.filter((message) => message.conversation_id === canonical.id);
    const sourceIds = new Set(sources.map((thread) => thread.id));
    const candidates = messages.filter((message) => sourceIds.has(message.conversation_id));
    const plan = planConsolidation(destination, candidates);
    const hasImage = (message: MigrationMessage) => !!readMessageMetadata(message.metadata).generatedImage;
    const before = [canonical, ...sources].map((thread) => {
      const records = messages.filter((message) => message.conversation_id === thread.id);
      return { id: thread.id, title: thread.title, messages: records.length,
        images: records.filter(hasImage).length,
        photos: records.filter((message) => message.content.startsWith("[Photo attached]")).length };
    });
    const mappings: Mapping[] = [];
    for (const message of plan.imports) {
      const source = sources.find((thread) => thread.id === message.conversation_id)!;
      const result = await client.query(`INSERT INTO assistant_messages
        (conversation_id,role,content,model,metadata,created_at)
        SELECT $1,role,content,model,
          (COALESCE(metadata::jsonb,'{}'::jsonb) || jsonb_build_object('threadConsolidation',
            jsonb_build_object('sourceConversationId',conversation_id,'sourceConversationTitle',$2::text,
              'sourceMessageId',id,'canonicalConversationId',$1::int)))::text,created_at
        FROM assistant_messages WHERE id=$3 RETURNING id`,
        [canonical.id, source.title, message.id]);
      if (result.rowCount !== 1) throw new Error("Source message changed during consolidation.");
      mappings.push({ sourceId: message.id, destinationId: result.rows[0].id,
        sourceConversationId: source.id, hasImage: hasImage(message) });
    }
    // Copy exact stored timestamps in SQL, retaining sub-millisecond precision.
    await client.query(`UPDATE assistant_conversations SET updated_at=
      GREATEST(updated_at,(SELECT max(created_at) FROM assistant_messages WHERE conversation_id=$1))
      WHERE id=$1`, [canonical.id]);
    const count = await client.query("SELECT count(*)::int AS count FROM assistant_messages WHERE conversation_id=$1", [canonical.id]);
    if (count.rows[0].count !== destination.length + plan.imports.length) throw new Error("Post-copy count mismatch.");
    const report: Report = {
      canonicalId: canonical.id, before,
      migratedMessages: plan.imports.length, migratedImages: plan.imports.filter(hasImage).length,
      duplicates: plan.duplicates.length, mappings,
      expectedCanonicalMessages: destination.length + plan.imports.length,
      expectedCanonicalImages: destination.filter(hasImage).length + plan.imports.filter(hasImage).length,
    };
    await client.query("COMMIT");
    if (mappings.length || !(await readFile(reportPath).catch(() => null))) {
      await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    }
    process.stdout.write(JSON.stringify({ stage: "copied", ...report }) + "\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verify() {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("Development preview domain is required.");
  const response = await fetch(`${base}/api/assistant/conversations/${report.canonicalId}`);
  if (!response.ok) throw new Error("Canonical thread could not be reopened.");
  const thread = await response.json() as { messages: Array<{ id: number; metadata: string | null }> };
  if (thread.messages.length !== report.expectedCanonicalMessages) throw new Error("Reopened message count differs.");
  const result = await pool.query("SELECT to_jsonb(m) AS record FROM assistant_messages m ORDER BY created_at,id");
  const records = result.rows.map((row) => row.record as MigrationMessage);
  for (const mapping of report.mappings) {
    const original = records.find((message) => message.id === mapping.sourceId);
    const imported = records.find((message) => message.id === mapping.destinationId);
    if (!original || !imported || messageFingerprint(original) !== messageFingerprint(imported)) {
      throw new Error("A copied message differs from the original content, timestamp, or metadata.");
    }
  }
  const imageChecks: NonNullable<Report["imageChecks"]> = [];
  for (const message of thread.messages.filter((message) => !!readMessageMetadata(message.metadata).generatedImage)) {
    const imageResponse = await fetch(`${base}/api/assistant/conversations/${report.canonicalId}/messages/${message.id}/image`);
    if (!imageResponse.ok) throw new Error(`Image ${message.id} could not be loaded after reopen.`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Saved image is not a PNG.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const mapping = report.mappings.find((item) => item.destinationId === message.id);
    if (mapping) {
      const original = await fetch(`${base}/api/assistant/conversations/${mapping.sourceConversationId}/messages/${mapping.sourceId}/image`);
      if (!original.ok || createHash("sha256").update(Buffer.from(await original.arrayBuffer())).digest("hex") !== sha256) {
        throw new Error("Imported image bytes differ from the source image.");
      }
    }
    imageChecks.push({ messageId: message.id, bytes: bytes.length, sha256 });
  }
  if (imageChecks.length !== report.expectedCanonicalImages) throw new Error("Image count mismatch.");
  // Exercise normal append persistence with no paid provider call or permanent test message.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(`INSERT INTO assistant_messages (conversation_id,role,content)
      VALUES ($1,'user','Non-persistent append fixture') RETURNING id`, [report.canonicalId]);
    const last = await client.query("SELECT id FROM assistant_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [report.canonicalId]);
    if (last.rows[0].id !== inserted.rows[0].id) throw new Error("New message did not append chronologically.");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  const reopened = await fetch(`${base}/api/assistant/conversations/${report.canonicalId}`);
  if (!reopened.ok || (await reopened.json() as { messages: unknown[] }).messages.length !== report.expectedCanonicalMessages) {
    throw new Error("Thread persistence or rollback probe failed.");
  }
  report.verified = true;
  report.imageChecks = imageChecks;
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ stage: "verified", messages: thread.messages.length,
    images: imageChecks.length, byteIdenticalImportedImages: report.migratedImages,
    appendProbe: "passed and rolled back", sourcePayloads: "unchanged" }) + "\n");
}

async function archive() {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  if (!report.verified) throw new Error("Cannot archive until reopen, payload, and image verification passes.");
  const { sources } = await readThreads();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE assistant_conversations, assistant_messages IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query("SELECT to_jsonb(m) AS record FROM assistant_messages m");
    const messages = result.rows.map((row) => row.record as MigrationMessage);
    const canonical = messages.filter((message) => message.conversation_id === report.canonicalId);
    const sourceIds = sources.map((thread) => thread.id);
    if (planConsolidation(canonical, messages.filter((message) => sourceIds.includes(message.conversation_id))).imports.length) {
      throw new Error("Source threads received new messages; verify another copy before archiving.");
    }
    await client.query("UPDATE assistant_conversations SET archived_at=COALESCE(archived_at,now()) WHERE id=ANY($1::int[])", [sourceIds]);
    await client.query("COMMIT");
    report.archived = true;
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ stage: "archived", retainedSourceIds: sourceIds, permanentlyDeleted: 0 }) + "\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const action = process.argv[2];
  if (action === "--copy") await copy();
  else if (action === "--verify") await verify();
  else if (action === "--archive") await archive();
  else throw new Error("Explicit --copy, --verify, or --archive is required. No automatic migrations.");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Consolidation failed"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
