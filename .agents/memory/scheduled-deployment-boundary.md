---
name: Scheduled deployment boundary
description: Preserve Autoscale when investigating separate reminder scheduling.
---

Do not treat the Publishing deployment-type dropdown as an “add second deployment” control. Verify current official navigation before proposing a separate scheduled worker, and preserve Lumen's Autoscale deployment.

**Why:** Documentation-search summaries gave contradictory answers about mixed deployment types. The procedural Publishing documentation describes a project-wide type change, and project artifacts share publishing settings. The user explicitly requires keeping Autoscale running.

**How to apply:** Consult the actual documentation pages, not only generated search summaries. A separate worker target must have a verified connection to Lumen's production database; its own default database or `NODE_ENV=production` is not sufficient proof. Never claim scheduling is active based only on a prepared command.

For the HTTP caller, use one dedicated Production External Access Token as both the private-gateway credential and LUMEN's worker bearer secret. Keep database and VAPID credentials with LUMEN.

**Why:** The user requires the separate caller to need only the production URL and one dedicated token. The private-project gateway authenticates before the API endpoint. Current official External Access Token documentation explicitly says Production tokens survive ordinary republishes, contrary to earlier assumptions.

**How to apply:** Send the same secret in Authorization and the dedicated worker header; never put it in a URL. Check current official expiry/revocation rules before rotation advice. Confirm activation using an actual scheduled caller run correlated with LUMEN production logs, not merely a source header or manual request.
