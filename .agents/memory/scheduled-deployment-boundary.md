---
name: Scheduled deployment boundary
description: Preserve Autoscale when investigating separate reminder scheduling.
---

Do not treat the Publishing deployment-type dropdown as an “add second deployment” control. Verify current official navigation before proposing a separate scheduled worker, and preserve Lumen's Autoscale deployment.

**Why:** Documentation-search summaries gave contradictory answers about mixed deployment types. The procedural Publishing documentation describes a project-wide type change, and project artifacts share publishing settings. The user explicitly requires keeping Autoscale running.

**How to apply:** Consult the actual documentation pages, not only generated search summaries. A separate worker target must have a verified connection to Lumen's production database; its own default database or `NODE_ENV=production` is not sufficient proof. Never claim scheduling is active based only on a prepared command.
