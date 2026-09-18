---
name: Calendar subscription transport
description: Transport handling for read-only calendar subscription feeds.
---

Calendar subscription values may use the `webcal` scheme, which Node's HTTP client cannot fetch directly. Convert only the scheme to HTTPS in memory before making a read-only request.

**Why:** Direct fetch fails, and mutating a parsed URL's protocol does not reliably convert a non-special `webcal` URL into an HTTPS URL.

**How to apply:** Replace the leading scheme in memory, validate that the resulting protocol is HTTPS, and never log, display, or persist the subscription URL.