# Architecture

Pi share history publishes a Pi session to a browser in real time. A Pi extension captures the current branch — messages, tool runs, summaries — and uploads it to a small self-hosted Node service. The service stores records in SQLite and streams change notifications to a static browser client over Server-Sent Events.

The design favors operational simplicity over features: no application framework, no build step, no viewer accounts, and a single process with one database file.

```mermaid
flowchart LR
    subgraph Pi["Publisher machine"]
        AGENT[Pi agent]
        EXT[pi-share-history extension]
        SESSION[(local Pi session)]
    end
    subgraph Server["Sharing service"]
        API[Node HTTP service]
        DB[(SQLite<br/>history.sqlite)]
        WEB[Static viewer assets]
    end
    subgraph Readers["Team browsers"]
        VIEW[Viewer SPA]
    end
    SESSION --> AGENT
    EXT -- "records, drafts, stop" --> API
    AGENT -- events --> EXT
    API --> DB
    API -- "update / removed events" --> VIEW
    VIEW -- "fetch transcript" --> API
    API -- static files --> WEB
```

## Components

**Extension.** Registers `/share` (or `/pishare` on Pi 1.5+), confirms publication, captures the branch, and keeps a pending map of records. A 1.5 s timer flushes bounded batches of stable record ids. Retries therefore upsert instead of duplicating. Failed uploads stay in memory. A graceful shutdown flushes once. Owner credentials are persisted as a Pi custom entry and never uploaded.

**Service.** A single `http.createServer` handler with hand-written routing. It validates configuration, serves the viewer from memory, owns the SQLite schema, enforces quotas and per-share key auth, and keeps SSE clients per share. Drafts and viewer connections are memory-only.

**Viewer.** Plain scripts served from the service origin. It fetches the whole transcript on every SSE invalidation and reuses DOM nodes by record id. Expansion state and scroll position therefore survive updates. Markdown is rendered in the browser with vendored Marked/DOMPurify. The stored text never changes.

```mermaid
sequenceDiagram
    participant P as Publisher (Pi)
    participant E as Extension
    participant S as Service
    participant V as Viewer
    P->>E: /share start + confirmation
    E->>S: POST /api/shares (upload key)
    S-->>E: {id, ownerKey, url}
    E->>S: POST /api/shares/:id/records (owner key)
    S->>S: upsert records, update live flag
    S-->>V: SSE "update"
    V->>S: GET /api/shares/:id
    S-->>V: full transcript + draft
    loop every 1.5 s while live
        E->>S: POST .../records (pending batch, optional draft)
        S-->>V: SSE "update"
        V->>S: GET /api/shares/:id
    end
    E->>S: POST .../stop
    S-->>V: SSE "update" (live=false)
```

## Data model

```mermaid
erDiagram
    SHARES ||--o{ RECORDS : contains
    SHARES {
        text id PK "32-char base64url"
        text owner "sha256(ownerKey)"
        text title
        int created "epoch ms"
        int updated "epoch ms"
        int live
        int revoked
    }
    RECORDS {
        text share FK
        text id PK "namespaced record id"
        text body "JSON record"
        int position
    }
```

Records are stored as opaque JSON bodies with a monotonically increasing `position`. Upserts replace the body but keep the original position, so re-sent streaming messages do not reorder the transcript. Drafts are not part of this model: they exist only in a process-local map.

## Deployment

```mermaid
flowchart TB
    NET([Public internet]) --> CADDY[Caddy :443]
    CADDY -- "/pi-history/*" --> APP[history container<br/>127.0.0.1:9080]
    CADDY -. "404" .-> ROOT[domain root<br/>other apps]
    APP --> VOL[(history-data volume)]
    PUB[Publisher with PI_SHARE_URL] --> CADDY
```

The container runs as an unprivileged `node` user with a 512 MB memory cap. It serves the viewer and API on one port. SQLite lives in a named volume, and `docker compose down -v` destroys it. Caddy terminates TLS, preserves the `/pi-history` prefix, redirects the legacy `/s/<id>` links, and disables proxy buffering for the SSE endpoint. The app port must stay private behind the proxy.

## Key decisions

- **Dependency-free service.** `node:http` plus built-in `node:sqlite`, no framework or build step, so deployment is a container and a volume.
- **Browser-only Markdown.** Stored text stays exact. Rendering and sanitization happen in the browser against committed vendor assets under a strict CSP.
- **Ephemeral drafts.** Unsent editor text is an explicit opt-in and lives only in memory. It expires after eight seconds and can never become history.
- **Per-share owner keys.** The upload key creates shares. Each share's owner key authorizes changes to that share. The service stores only a hash, and the local Pi session stores the key.
- **Public by default.** The viewer has no login. Confidentiality depends on a VPN or an authenticated proxy, and the UI says so.
- **`/pishare` on new Pi.** Pi 1.5 reserves `/share`. The extension keeps `/share` for older versions and answers to `/pishare` everywhere.

Full specs live in `.ai/spec/`. Start with `.ai/spec/what/system-overview.md` for behavior and `.ai/spec/how/project-structure.md` for code navigation.
