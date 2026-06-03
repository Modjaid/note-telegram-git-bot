# Runtime boundaries (host vs gateway vs agent worker)

Aligned with [DEVELOPMENT_ROADMAP.md](../DEVELOPMENT_ROADMAP.md) Q4 and [PRODUCT_SPEC.md](../PRODUCT_SPEC.md).

## Host CLI (`src/cli/`)

| Runs on | Responsibility | Does not |
|---------|----------------|----------|
| User OS (Windows / macOS / Linux) | Read/write `~/.note-agent/instances.json`, Docker create/start/stop/restart, bind-mount host dirs, wizard prompts | Telegram polling, ADK, Git inside the repo |

**Entry:** `dist/cli/cli.js` (`note-agent` bin).

**Host paths** (see `src/paths/`):

- `~/.note-agent/instances.json` — secrets registry
- `~/.note-agent/instances/<containerName>/UserRepo/` → container `/app/UserRepo`
- `~/.note-agent/instances/<containerName>/rag/` → container `/app/rag`

## Gateway (`src/runtime/gateway/`)

| Runs on | Responsibility | Does not |
|---------|----------------|----------|
| Inside the user’s Docker container (process 1) | Telegram **long polling** (Q5), `MessengerHandler`, default `<NoteLog>` capture, immediate Git commit/push after `UserRepo/` writes, RAG reconcile **hooks** | Block on long LLM / ADK calls |

**Entry:** `dist/runtime/gateway/main.js` (started by container entrypoint — P2-T01).

**Uses:** `src/messenger/` (adapter, handler, types).

**Delegates to worker:** slash-command dialogs, `/agent`, messages over 60 words (long-post pipeline), user `/<CommandName>` execution — via in-container IPC (P2-T08).

## Agent worker (`src/runtime/agent-worker/`)

| Runs on | Responsibility | Does not |
|---------|----------------|----------|
| Same container (process 2) | Google ADK agent, indexed/long-post files, command authoring, command analysis LLM passes | Telegram `getUpdates` loop |

**Entry:** `dist/runtime/agent-worker/main.js` (started with gateway by entrypoint).

**Secrets:** LLM API keys needed only in the worker (or via IPC contract); gateway passes non-secret instance config.

## Shared libraries

| Path | Used by |
|------|---------|
| `src/config/` | CLI (registry, LLm picker), runtime (read resolved models) |
| `src/paths/` | CLI (host dirs), gateway/worker (container paths, `note_telegram_bot/` layout) |
| `src/messenger/` | Gateway only |

## One container per instance

```
Host                          Docker container
────                          ────────────────
note-agent (CLI)              ┌─ gateway ─── Telegram, handler, daily, git hook
  │                           │
  ├─ instances.json           └─ agent-worker ─ ADK, IPC server
  ├─ instances/<name>/UserRepo ──mount──► /app/UserRepo
  └─ instances/<name>/rag ──────mount──► /app/rag
```

## Build artifacts

| Script | Output |
|--------|--------|
| `npm run build:cli` | `dist/cli/`, `dist/config/`, `dist/paths/` |
| `npm run build:runtime` | `dist/runtime/`, `dist/messenger/`, shared `dist/config/`, `dist/paths/` |
| `npm run build` | Both |
| `npm run typecheck` | Full `src/` (CLI + runtime + shared) |
