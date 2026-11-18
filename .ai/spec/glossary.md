# Glossary

| Term | Meaning |
|---|---|
| **At rest** | No hover and no keyboard focus. |
| **Service** | The self-hosted Node process. It owns SQLite, serves the API, and serves the viewer. Do not call it the server, except in the `server/` code path. |
| **Extension** | The Pi plugin in `extension/`. It captures records and uploads them. |
| **Share** | One published Pi session. A `shares` row holds its id, title, owner hash, timestamps, live flag, and revoked flag. |
| **Transcript** | The ordered records of a share, as a viewer sees them. |
| **Record** | One unit of published transcript (message, tool execution, notice, summary). The service stores each record as JSON in `records`. |
| **Record count** | The number of stored records in a share. The directory shows it for each share. |
| **Relative time** | A last-updated time shown as a distance from now, for example `2h ago`. |
| **Upload key** | The team-wide secret (`UPLOAD_KEY` / `PI_SHARE_KEY`). The service requires it to create a share. |
| **Owner key** | The per-share secret returned at creation and persisted in Pi. It authorizes writes to that share. |
| **Owner entry** | The Pi custom entry `pi-share-history-owner-v1`. It holds `{id, ownerKey, url, server}`. |
| **Live share** | A share that accepts uploads and reports live. It stays live while its last upload is less than 20 seconds old. |
| **Saved transcript** | A share that is readable but not live. |
| **Share state** | The live or saved condition of a share, shown in the header as a dot and a state word. |
| **Draft** | A preview of unsent editor text. It lives only in memory and is never persisted. |
| **Base path** | The path portion of `PUBLIC_URL` (for example `/pi-history`). All routes live under it. Also called the prefix. |
| **Record kind** | The role label of a record, such as `user`, `assistant`, `tool`, `toolResult`, `notice`, or `compaction`. |
| **Turn** | One unit of a transcript. It is one message record, or one tool group between two messages. |
| **Deep link** | A transcript URL with a `#<record-id>` fragment. On load, the viewer moves to that record. |
| **Copy-link action** | A per-turn control. It copies the deep link to that turn. |
| **Read mode** | The default transcript view. It shows prompts, replies, errors, and notices. It hides tool activity, summaries, and metadata at rest. |
| **Advanced mode** | The optional transcript view. It shows every record, including tool activity, summaries, thinking, and metadata. |
| **Thinking** | A model reasoning block. Pi records it with the assistant message. The extension publishes it in the record's `thinking` field. Read mode hides it and Advanced mode shows it. |
| **New-activity pill** | A control at the bottom of the viewport in a transcript. It appears when records that the current view mode shows arrive while the user is away from the bottom. It shows the count of those records. |
| **Tool group** | One disclosure row for consecutive `tool`, `toolResult`, and `bashExecution` records between two messages. |
| **Publisher** | A Pi user who runs the extension against the service. |
| **Viewer** | A browser that reads the directory or a transcript. It needs no authentication. |
| **Admin key** | The operator secret `ADMIN_KEY`. It authorizes every owner action on every share. |
| **Admin page** | The operator surface at `<prefix>/admin/`. It lists every share and deletes one. |
