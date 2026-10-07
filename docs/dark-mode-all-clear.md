# Dark Mode and All Clear

Dark Mode is a persisted Lumen privacy state. It suppresses reminder push notifications while assistant conversations and background processing continue. All Clear resumes delivery and releases only reminders that became due within the previous three minutes; older reminders are marked handled without a late alert. The service worker checks the current state and reminder age before displaying a push that was already queued by the push service.

The top-right switch changes the state. In the composer, the exact commands `Dark Mode`, `Go dark`, or `Silent mode` activate it; `All Clear`, `Resume notifications`, or `End dark mode` turn it off. Repeating the active command leaves the current state alone.

## iPhone Focus automation

Safari and an installed web app cannot read the active iPhone Focus mode directly. To have Focus changes update Lumen without polling, create an iOS Shortcuts personal automation for each Focus mode and use **Get Contents of URL** to send a `PUT` request to:

`https://<your-Lumen-host>/api/push/privacy`

Use a JSON request body with `Content-Type: application/json`:

- When the Focus turns on: `{ "darkMode": true }`
- When the Focus turns off: `{ "darkMode": false }`

All Clear applies the same three-minute release window. The app refreshes its switch when it next returns to the foreground.

## Database setup

After pulling this change, apply the added table through the existing Drizzle workflow:

`pnpm --filter @workspace/db run push`
