# Known issues

## Message POST marked aborted while the reply still appeared

On 2026-09-24 in the development preview, one message POST was logged as aborted after approximately 4.3 seconds. The provider later completed, both messages were saved, and the user confirmed that the reply appeared in Lumen. The cause of the connection abort is unknown.

Track this independently from web-search result quality. Do not infer that the reply was lost, or change request timeouts or retries without reproducing and correlating browser and server events.