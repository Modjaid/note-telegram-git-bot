## Cross-platform (host)

- Supported host OS: Windows 10+, macOS 12+, Linux (x64/arm64).
- Requirement: Docker (Desktop on Windows/macOS, Engine on Linux).
- CLI: Node.js ≥ 18; secrets in `~/.note-agent/instances.json` (chmod 600).
- **One instance = one isolated Docker container** (Telegram adapter, message handler, agent, Git sync, RAG). Instances do not share `UserRepo/` or `rag/`.
- All bot/handler/agent/git logic runs inside a Linux container only; the host CLI manages lifecycle and secrets only.

## Docker (instance data)

Each added repository is a **separate isolated service in a Docker container**. Abrupt reset, recreation, or image upgrade **must not lose** notes or RAG: both directories live on the host via bind mount, not in the container’s ephemeral filesystem.

```text
~/.note-agent/instances/<containerName>/
  UserRepo/    # git working copy → /app/UserRepo
  rag/         # vector DB + file mtime registry → /app/rag
```

- **UserRepo/** — full git working copy of the user’s repository. Survives container deletion/rebuild; remote sync via push.
- **rag/** — local vector database and index metadata (including **recorded modification time** for each indexed path). Survives container deletion/rebuild; **not** committed to Git.

### Git (per instance)

- **Container start:** PAT → clone into `UserRepo/`; if `.git` already exists — pull. After a successful pull — **re-index** files that were added, changed, or removed relative to the RAG registry (see below).
- **Every write or change** in `UserRepo/` (daily, indexed, config, command results, etc.): immediately **commit + push** to this instance’s configured **repository branch** (e.g. `node_telegram_bot`). Deferred push by timer is not used.
- **Restart via CLI:** stop the container (gateway pushes unpushed `UserRepo` commits on SIGTERM), then optionally start again. The host CLI does not run `git`.

### RAG (per instance)

- RAG **always stores the modification date** (mtime or equivalent) of each indexed file in `UserRepo/` and uses it to decide what must be re-indexed.
- **Indexing scope:** all of `UserRepo/` **except** `note_telegram_bot/config/` (settings, commands, and tasks are read from disk when invoked; not indexed in RAG). Do not index: `.git/`, binary files, and non-text files without meaningful content.
- Embeddings use the instance RAG model from `LLmModels.json`; one API key per instance (see Q6 in roadmap).

#### Indexing strategies (chunking)

Every indexed file yields **one or more chunks**; the RAG registry stores for each chunk: repo-relative path, chunk index within the file, file mtime, embedding, chunk text, and **metadata** (chunk type, date/id for daily, `CommandId`/`Period` for command outputs, etc.).

| Area | Split strategy |
|------|----------------|
| **`note_telegram_bot/daily/`** | One `<NoteLog>` line = **one chunk** (format `HH:mm:<Index> …` — in CORE). In chunk text/metadata: logical day (`DD_MMM_YYYY`), full note id `YYYY:MMM:DD:HH:mm:<Index>`, `<type>` when present. Lines that are not log-format are not indexed. |
| **`note_telegram_bot/indexed/`** (long post) | **Two levels:** (1) **summary chunk** — `<shortDescription>` + `#` tags (for “similar file” / wikilink search); (2) **body chunks** — full text, split by paragraphs and `##` headings, target size ~500–800 tokens, **10–20% overlap** between adjacent body chunks. |
| **`note_telegram_bot/indexed/`** (`/<CommandName>` output) | `<Summary>` — separate chunk (or several if long); each `<AILogs>` line — **separate chunk** (like daily); metadata: `CommandId`, `<Period>`. |
| **Other markdown in `UserRepo/`** | **Structure-aware:** split on `#` / `##` headings first; large sections further by paragraphs up to ~500–800 tokens; 10–20% overlap. Prefix chunk text for embedding with context: file path + section heading. |
| **Other plain text in `UserRepo/`** | Sliding window of fixed size (~500–800 tokens) with 10–20% overlap. |

On re-index of a file, old chunks for that path are removed from the vector store and registry, then new chunks are written.

#### Search strategies

| Scenario | Behavior |
|----------|----------|
| **Wikilinks** (long post, see CORE) | Semantic search over **`indexed/`** chunks; for “similar **file**” prefer **summary chunks** (on equal score — best body chunk of the same file). Daily is **not** included in this search. |
| **Knowledge-base question** (`/agent`, see CORE) | Semantic search over **all** indexed chunks in `UserRepo/` (except `config/`): top-k relevant chunks → LLM **summarizes** them into an answer. The reply is built from retrieved **pieces**, not whole files. |
| **Hybrid (recommended for long md)** | Vector similarity + keyword overlap on chunk text; combined score for ranking. |
| **Fallback** | If the embedding model is unavailable — keyword search over chunk text (no vectors). |

top-k and similarity thresholds are implementation details; if few results match, the agent reports that the knowledge base has little relevant content.

#### Reconcile (index sync with disk)

After a **local write** by the bot or after **pull** of new/remote changes — reconcile disk with the RAG registry:

- file is **new** or **mtime is newer** than the RAG entry → index or re-index using the chunking table above;
- file **deleted** from disk → remove all chunks for that path and the RAG registry entry.

Pull from remote and local bot edits use the **same** algorithm. Manual full re-index — via `/agent` (CORE).

## CORE

### CLI (startup and instances)

- On program start: CLI reads a secret file with the list of previously added instances.
- Show which containers are running and which are not.
- Offer to restart an instance or add a new repository.
  - Restart: stop the container (Git push on shutdown is handled inside the container), then optionally start again.
- Offer to add a new repository and create an isolated agent system in a Docker container for it; everything is saved to the secret file for recovery.
  - Choose a container name.
  - Telegram bot token where user messages arrive.
  - Pick an LLM from `LLmModels.json` for the agent.
  - API key for the chosen LLM.
  - From the list, cache sub-models for RAG and for Dialogue (from the selected `LLmModels.json` entry); inform the user about sub-models and that the API can be changed via the agent.
  - Telegram user id — only this user’s messages are handled.
  - Git PAT for syncing the notes folder.
  - Repository URL.
- After setup, CLI reports that everything is running and returns to the main menu.

### Container start and repository layout

- **All** service components (message handler, agent, etc.) run only inside an isolated Docker container.
- After container start: connect to the repository via PAT and sync everything into `UserRepo/` (if `.git` exists — pull, otherwise clone).
- Ensure `note_telegram_bot` exists; create it if missing — all bot data is written there.
- File layout:

```text
UserRepo/                          # user repository; fully indexed in RAG except note_telegram_bot/config/
  note_telegram_bot/               # bot folder
    daily/                         # raw daily entries (DD_MMM_YYYY.md, e.g. 02_Jun_2026.md)
    indexed/                       # long posts, /<CommandName> outputs, wikilinked notes
    config/                        # agent settings, tasks, commands (not indexed in RAG)
```

- **Git branch** (e.g. `node_telegram_bot`): create and checkout if missing after clone/pull; all bot writes commit and push to this branch.
- Start: Telegram Adapter, Message Handler, local RAG index database, and agent (handler talks to the agent; the bot does not reply to other users).

### Message handling (default)

- By default, the Telegram handler saves all messages to notes (format — `<NoteLog>` section below).
- Agent dialog modes: **no** note capture; usually entered via `/`.
  - In dialog mode, user reply is expected within **3 minutes**; if none — return to note capture.
  - Or the dialog ends when the command goal is reached.
- User has default `/` commands and custom ones added in agent dialog. The agent creates commands and scripts and registers them in the handler.

### Default slash commands

#### `/agent`

- Opens a fresh agent dialog; message: “the agent is listening”.
- Each agent message ends with: `/exit`.
- User may ask to:
  - **Re-index the knowledge base.** Agent reconciles **all of** `UserRepo/` (except `note_telegram_bot/config/`) with the RAG registry and indexes files that were **not** indexed or **were updated** (chunking strategies — RAG section above).
  - **Add a personal command** `/<commandName>` — agent dialog to create it.
    - Command file: `UserRepo/note_telegram_bot/config/commands/CommandName.md`, created by the agent.
    - Agent explains: commands are a way to analyze daily entries and organize goals; after creation the command can be invoked and scheduled.
    - Agent asks for analysis and note-search details, fills fields from the dialog, shows a draft, adjusts on request. When approved — saves the file with:
      - `<commandName>` — agent generates briefly from the prompt, e.g. `/lastWeekHealthSum`
      - generated `<CommandId>` — id from a generator function
      - `<Period>` — logical period, e.g. `last_7_logical_days` or `last_month`, from user prompt
      - `<shortDescription>` — short text for `/commands` (agent-generated)
      - `<Prompt>` — nature of note analysis, detailed description for search and links; full prompt from dialog. User may request a table in `<Summary>` and help with columns.
  - **Create `<task>` in Schedule** — if the user wants one-off or recurring reminders.
    - Agent explains: only user analysis commands run on schedule; the agent is an analyzer, not a direct assistant, but periodic analysis supports decisions. Suggests `/commands` and adding a new command (see “Add a personal command”).
  - **Ask a knowledge-base question.** Any free-form user question not covered above (re-index, command, Schedule).
    - Agent searches **by meaning** in RAG across all of `UserRepo/` (except `note_telegram_bot/config/`), collects relevant chunks, summarizes them, and replies.

#### `/commands`

- Script lists all commands (default and user) as: `/<commandName> - <shortDescription>`.

#### `/<CommandName>` (user command)

- Loaded from `UserRepo/note_telegram_bot/config/commands/CommandName.md`.
- **Create md file** `UserRepo/note_telegram_bot/indexed/<topic_of_sum>_DD_MMM_YYYY.md`, where `<topic_of_sum>` comes from the final `<Summary>`, date is the file creation day. File structure:
  - `<commandId>` — `CommandId:` — command id to find prior runs
  - `<Period>` — in the command may be `last_7_logical_days`; in the file — `from date to date` of the actual analysis
  - `<Summary>` — LLM result from `<Prompt>`, `<AILogs>` for the period, same-command files for the period, dynamics of changes, focus, and priorities
  - `<AILogs>` — array of individually processed log notes (unlike `<NoteLog>`); top to bottom by time; format:
    - `"YYYY:MMM:DD:HH:mm:<index> <type> <Note>"` — `<Note>` already processed by LLM for aggregation in `<Summary>` per `<Prompt>`
- **Note analysis algorithm:**
  - Script finds all files in `note_telegram_bot/indexed/` whose header contains `commandID: <commandID>`.
  - If id matches the invoked command — read `<Period>` in the file (analysis date range).
    - If part of `<Period>` overlaps the current period:
      - If `<Prompt>` needs dynamics from past analyses — in the new file’s `<AILogs>` store the found file’s `<Summary>` with log type `"Summary from date to date"`.
      - If `<Prompt>` is period-only analysis — take logs from `<AILogs>` that fall in the command period and write to own `<AILogs>`.
  - Loop daily files in the remaining time range (not covered by indexed); files may be absent.
    - For each daily, LLM picks logs from `note_telegram_bot/daily/DD_MMM_YYYY.md` related to `<Prompt>`; returns processed logs with adapted `<Note>` for `<Summary>` in format `YYYY:MMM:DD:HH:mm:<Index> <type> <Note>`.
    - Script checks `<type>` of processed logs; for `"Post <fileName>"` — refine `<fileName>.md` via LLM for `<Summary>` per `<Prompt>`; rewritten logs saved in `<logIds>`.
  - With full `<AILogs>` array, run final processing and build `<Summary>`.

#### `/Schedule`

- Lists all `<task>`.
- `<task>` — scheduled invocation: when, how many times, and at what interval to call `/<CommandName>` (via cron):
  - once at a set time;
  - with repetitions;
  - with regularity and periodicity.

### Saving `<NoteLog>` from messages

- `<NoteLog>` — one entry in the array in `Daily/DD_MMM_YYYY.md`.
- User region is stored in `UserRepo/note_telegram_bot/config` to compute **local** time from UTC message metadata. If missing — short dialog and save region.
- All `<NoteLog>` entries go to `daily/` in `DD_MMM_YYYY.md` for the current logical day; file is created on first entry that day.
- Logical day: **6:00 → 6:00**; otherwise a new daily file is created.
- `<NoteLog>` entries top to bottom — morning to evening, with spacing between logs.
- Line format: `"HH:mm:<Index> <type> <Note>"`, where:
  - `<Index>` — sequence when multiple notes share one minute (12:02:00, 12:02:01, …); full note id: `YYYY:MMM:DD:HH:mm:<index>` (looks like seconds but is index from 00).
  - `<type>` — only in special cases, otherwise omitted. Variants:
    - **`Long filename.md`** — message longer than 60 words; agent:
      - creates `indexed/filename.md` with a clear name;
      - inserts the full message;
      - adds `<shortDescription>` — short summary (may exceed 60 words for large text);
      - adds semantic `#` tags;
      - via RAG finds similar files **in `indexed/`** and adds `[[FILENAME]]` links;
      - indexes the file in the vector DB;
      - writes `<shortDescription>` in daily `<Note>`.
    - **`forwarded from @telegramNickName`** — forwarded message; `<Note>` may include original time, `<NoteLog>` header — bot receive time.
    - **`forwarded from @telegramNickName + Long filename.md`** — forwarded long message with summary.
    - **`Summary from date to date`** — usually not in daily; for logs in indexed files from `/<CommandName>`.
  - `<Note>` — the note or its summary.
- Bot briefly reports work done: what was written to daily, or summary + separate file for long messages.
