# Reminder delivery: production setup and schema review

The Autoscale web deployment is unchanged. The due worker does not run as a
web-server timer. Production automation requires a **separately configured
Replit Scheduled Deployment**; preparing this code does not activate that job.

## Scheduled Deployment settings

- Cron: `* * * * *` (every minute; timezone does not affect this expression).
- Run: `pnpm --filter @workspace/api-server run push:due`
- Build/preparation: `pnpm install --frozen-lockfile --prod=false`
  (the command runs TypeScript through the existing `tsx` dependency).
- Set `NODE_ENV=production`.
- Use the **same production PostgreSQL database** as the Autoscale app. Do not
  accidentally use the workspace database or a separate job's empty database.
- Provide the production `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
  `VAPID_SUBJECT` through Replit's secrets/settings, without copying values into
  code, command arguments, or logs.
- Allow enough job timeout for the subscription count (each network send has an
  eight-second timeout). Overlapping runs are safe: locked reminders are skipped.
- Publish/activate the separate job only after reviewing and applying the
  reminder schema via the normal web-app Publish flow.
- Do not replace the web app's deployment type or production start command.
  If the UI offers replacing the existing Autoscale deployment rather than
  adding a separate scheduled job, stop and obtain a separate deployment target.
- No public HTTP endpoint, private-app bypass token, or cron HTTP request is
  needed: this job connects directly to the production database.

Every-minute scheduling adds up to approximately one minute of delivery delay,
plus startup/network time. Relative deadlines remain exact; notification arrival
is not guaranteed at the exact second.

## Required database changes only

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
