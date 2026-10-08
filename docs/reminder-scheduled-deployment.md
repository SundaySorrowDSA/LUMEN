# Reminder delivery: production setup and schema review

The Autoscale web deployment is unchanged. The due worker runs inside LUMEN
through an authenticated, bodyless endpoint:

`POST /api/internal/reminders/run-due`

Production automation requires a **separate Scheduled Deployment project**
running the minimal HTTP caller. Preparing this code does not activate a job.
Do not change LUMEN's project-wide deployment type to Scheduled.

## Scheduled Deployment settings

1. In **LUMEN → Publishing → Adjust settings → Security → External access
   tokens → Create access token**, create a dedicated token labeled
   `Reminder scheduler`, with **Production** environment and a suitable expiry.
   Select **Copy token only**. Never use the query-parameter copy action.
2. Store it as the secret `LUMEN_REMINDER_WORKER_TOKEN` in LUMEN. Republish
   LUMEN normally, retaining Autoscale and private access. Current Replit docs
   confirm Production External Access Tokens survive ordinary republishes.
3. Prepare a **separate, standalone Node 22+ project**, not a new artifact in
   LUMEN. Copy `scripts/src/call-reminder-worker.mjs` into that project as
   `call-reminder-worker.mjs`. It needs no npm dependencies or web server.
4. In that caller project set:
   - environment variable `LUMEN_PRODUCTION_URL`:
     `https://personal-ai-assistant-SundaySorrow.replit.app`
   - secret `LUMEN_REMINDER_WORKER_TOKEN`: the same dedicated token.
   The caller needs **no database connection or VAPID keys**.
5. Open **Tools → Replit Cloud → Publishing** (or the editor's **Publish**
   control) in the **caller project**. Under **Adjust settings → Deployment
   type**, choose **Scheduled**.
6. Set:
   - Cron: `* * * * *` (every minute; timezone does not affect this expression).
   - Run: `node call-reminder-worker.mjs`
   - Build: none; only the Node runtime and this file are required.
   - Job timeout: at least 60 seconds. Caller HTTP timeout is 55 seconds.
7. Publish/activate **that separate Scheduled project**. Never choose Scheduled
   in LUMEN's own deployment dropdown.

The caller sends the same dedicated bearer token in `Authorization` for Replit's
private-project gateway and `X-Lumen-Worker-Authorization` for the application
guard. The second header remains usable if the gateway consumes Authorization.
No token is sent in the URL or logged. Other valid Replit access tokens do not
authorize the worker unless they match LUMEN's dedicated secret.

The external token grants access through the private project's protection, not
only to this endpoint. Treat it as a sensitive credential. If it expires or is
revoked, replace it in both projects and republish affected settings. Do not
make LUMEN public to avoid this requirement.

Database/VAPID credentials remain exclusively with LUMEN. The existing delivery
function uses LUMEN's production runtime database; the caller has no database
code and cannot accidentally operate on its own workspace database.

`pnpm --filter @workspace/api-server run push:due` remains available as a direct
operator command, but is **not** the separate caller's scheduled command.
Do not run it manually against production as a test.

## Activation verification — separate from code readiness

Do not report "schedule active" based on a code change, republish, manual request,
or the request's scheduler-source header. That header is a caller assertion.

After an actual scheduled run:

1. In the **caller project's Publishing run history/logs**, find an automatic
   scheduled run with `scheduled_call_completed` and its `runId`.
2. In **LUMEN's production Publishing logs**, find the matching `runId` on
   `worker_request_authorized` and `worker_request_completed`, including
   delivery counts and any Dark Mode suppression.
3. Confirm later minute runs repeat. A zero-reminder successful invocation
   confirms execution, not notification delivery.

`scheduled_call_failed`, HTTP 401/403/503, redirects, invalid responses, and
timeouts are failures, not activation proof. Worker partial failures return
HTTP 502 and make the caller exit nonzero. No automatic immediate HTTP retries
are made; the next scheduled minute retries through existing locks/receipts.

LUMEN rejects missing/incorrect bearer credentials, missing secret configuration,
all query parameters, and `X-Lumen-Test-Mode: isolated` before invoking delivery.

Every-minute scheduling adds up to approximately one minute of delivery delay,
plus startup/network time. Relative deadlines remain exact; notification arrival
is not guaranteed at the exact second.

## Required database changes only

The authenticated endpoint and caller add **no new database changes**. The
following describes the existing reminder-delivery migration already prepared
for LUMEN:

Add to `assistant_reminders`:

- nullable `conversation_id`, with a foreign key to `assistant_conversations`;
- `chat_status` (default `pending`) and nullable `chat_delivered_at`;
- `push_status` (default `pending`), nullable `push_attempted_at`, and
  nullable `push_last_error` (sanitized code only).

Create `reminder_push_receipts`: reminder ID, subscription ID, accepted timestamp,
serial ID, and a unique reminder/subscription index. Reminder ID references
`assistant_reminders`; subscription IDs remain historical references after
expired endpoints are deleted.

No other schema change is part of this feature. Review the actual
development-to-production diff before publishing; do not blindly accept
unrelated statements. No production DDL or automatic startup/build migration
script is included.

An existing unrelated `assistant_submissions` table is not defined in this
branch's Drizzle source. It is intentionally retained. A blanket Drizzle
schema push could propose removing it; do not accept that removal as part of
reminder delivery. Development received only the scoped additive reminder
changes. The reviewed Publish diff contains ten reminder-only statements,
no drops/truncations, and no unrelated migration.

## Delivery semantics and diagnostics

- New reminders retain their originating conversation. Legacy reminders use
  unique verified creation metadata; unknown/ambiguous origins become `unlinked`
  and are never posted to the current/active conversation as a fallback.
- Chat insert, conversation timestamp update, chat delivery timestamp, and push
  receipts commit under a per-reminder transaction and `FOR UPDATE SKIP LOCKED`.
  A committed chat message is never inserted again on a normal retry.
- Push failures remain retryable during the existing three-minute window.
  Partial retries skip subscriptions with committed acceptance receipts.
- `notification_sent_at` means a push service accepted at least one send, not
  that the device displayed it. `chat_delivered_at` means chat persistence
  succeeded, not that the user read it.
- Stale pushes become `expired`, never falsely `sent`. Overdue chat still
  delivers. Dark Mode suppresses external pushes, not stored chat messages.
- Overall `completed` means channel processing ended; consult channel states
  to distinguish actual delivery from expiry or an unlinked origin.
- Old `notification_sent_at` values are retained, not reinterpreted/backfilled
  as proof: the previous stale-reminder code could write those without sending.
- Structured logs identify selection, chat attempts/commits, push attempts,
  push-service HTTP results, failed/expired/suppressed pushes, and job summaries.
  Logs omit reminder text, endpoint tokens, encryption keys, and raw exceptions.
- External push acceptance cannot be atomic with PostgreSQL. A process crash or
  lost network acknowledgement after acceptance but before DB commit can still
  cause a repeated push. The existing stable reminder notification tag reduces
  duplicate visible notifications; this is not an exactly-once guarantee.
- Nonzero job exit status indicates failures requiring attention. Normal
  subsequent scheduled runs retry eligible pending channels.

Do not invoke the worker against production as a test: it writes messages and
can send real notifications. Use mocked tests. Also confirm that the installed
PWA is using the published origin: workspace reminders/subscriptions are not
visible to a production worker.
