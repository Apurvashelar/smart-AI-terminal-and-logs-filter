# Smart Terminal Filter — Complete Technical Documentation

---

## Table of Contents

1. [What is this project?](#1-what-is-this-project)
2. [Architecture Diagram](#2-architecture-diagram)
3. [How data flows end-to-end](#3-how-data-flows-end-to-end)
4. [File-by-File Explanation](#4-file-by-file-explanation)
5. [Key Technical Concepts Explained](#5-key-technical-concepts-explained)
6. [How Filtering Works](#6-how-filtering-works)
7. [AI Layer Explained](#7-ai-layer-explained)
8. [CLI vs VS Code Extension](#8-cli-vs-vs-code-extension)
9. [How to Release a New Version](#9-how-to-release-a-new-version)

---

## 1. What is this project?

**Smart Terminal Filter** is two things in one:

1. **A VS Code Extension** — adds a panel inside VS Code that shows a cleaned-up version of your terminal output. It watches every terminal you open and filters the noise in real time.

2. **A Standalone CLI tool** (`smartlog`) — lets you pipe any command's output through it in any terminal, on any machine, even outside VS Code.

Both share the same core logic: classify every line of output, score it for noise, and decide whether to show it or hide it.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS CODE EDITOR                           │
│                                                                 │
│  ┌──────────────┐     ┌─────────────────────────────────────┐  │
│  │   TERMINAL   │     │         EXTENSION PROCESS           │  │
│  │              │     │                                     │  │
│  │ npm start    │────►│  LogInterceptor                     │  │
│  │ mvn compile  │     │  (captures raw terminal output)     │  │
│  │ docker up    │     │           │                         │  │
│  │              │     │           ▼                         │  │
│  └──────────────┘     │  FilterEngine (orchestrator)        │  │
│                       │           │                         │  │
│                       │    ┌──────┼──────┐                  │  │
│                       │    ▼      ▼      ▼                  │  │
│                       │  LogClas- Stack  Frame-             │  │
│                       │  sifier  Trace  work                │  │
│                       │         Grouper Detector            │  │
│                       │           │                         │  │
│                       │           ▼                         │  │
│  ┌──────────────┐     │  FilteredEntry[]                    │  │
│  │  SIDEBAR     │◄────│  (visible / hidden)                 │  │
│  │  PANEL       │     │           │                         │  │
│  │  (Webview)   │     │           ▼                         │  │
│  │              │     │  StatusBar + Toast notifications    │  │
│  │ ✓ Errors     │     │                                     │  │
│  │ ✓ Warnings   │     │  ┌──────────────────────────┐      │  │
│  │ ✓ Your logs  │     │  │     AI LAYER (optional)  │      │  │
│  │              │     │  │  Claude / OpenAI / Ollama│      │  │
│  │ [Explain]    │────►│  │  ErrorExplainer          │      │  │
│  │ [Summarize]  │     │  │  LogSummarizer           │      │  │
│  │ [Ask...]     │     │  │  NaturalLanguageQuery    │      │  │
│  └──────────────┘     │  └──────────────────────────┘      │  │
│                       └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    STANDALONE CLI (any terminal)                 │
│                                                                 │
│   npm start  ──pipe──►  smartlog  ──►  filtered output          │
│   mvn compile 2>&1 ──►  smartlog -e    (only errors shown)      │
│   docker logs -f   ──►  smartlog -s    (+ summary at end)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. How Data Flows End-to-End

Here is the exact journey a single terminal line takes through the system:

```
Step 1: You run "mvn compile" in VS Code terminal
        │
        ▼
Step 2: LogInterceptor detects the output
        (listens to VS Code's terminal data events)
        │
        ▼
Step 3: Raw line arrives e.g.:
        "[ERROR] /Users/.../NotesApplication.java:[26,6] cannot find symbol"
        │
        ▼
Step 4: LogClassifier.classify() runs
        - Strips ANSI color codes → "cleaned" version
        - Detects level     → ERROR
        - Detects category  → ERROR_MESSAGE
        - Computes noise score → 0 (errors are pure signal)
        - Detects source file → NotesApplication.java:26:6
        - Checks if it's red in terminal → isAnsiRed = true
        │
        ▼
Step 5: StackTraceGrouper.processLine() runs
        - Is this an error header? → Start new group
        - Is this a stack frame?   → Add to current group
        - Is it unrelated?         → Close current group
        │
        ▼
Step 6: FilterEngine.shouldShow() decides visibility
        - Is verbosity 5? → show everything
        - Is it ERROR or USER? → always show
        - Is noise score low enough? → show
        - Is it a duplicate error? → hide
        │
        ▼
Step 7: FilteredEntry created { line, visible: true/false, stackGroup }
        │
        ▼
Step 8: WebviewPanel.sendEntry() sends it to the sidebar UI
        │
        ▼
Step 9: StatusBar updates (error count, flash animation)
        │
        ▼
Step 10: User sees only the important line in the panel
         Everything else is hidden
```

---

## 4. File-by-File Explanation

### `src/extension.ts` — The Entry Point
**What it is:** The main file that VS Code runs when it loads your extension.

**What it does:**
- Creates all the subsystems (LogInterceptor, FilterEngine, WebviewPanel, StatusBar)
- Registers all commands you see in the Command Palette (e.g., "Smart Terminal: Open Panel")
- Connects everything together — when LogInterceptor gets data, it sends it to FilterEngine, which sends it to the panel
- Manages the AI API key securely using VS Code's built-in keychain

**Key technical term — `activate()`:**
This is the function VS Code calls when the extension starts. Everything begins here.

**Key technical term — `context.subscriptions`:**
A list of things to clean up when the extension is turned off. Like a "teardown" list.

---

### `src/logInterceptor.ts` — The Data Capturer
**What it is:** Hooks into VS Code's terminal system to read what's being printed.

**What it does:**
- Listens to three VS Code APIs simultaneously:
  1. `onDidWriteTerminalData` — catches raw output character by character
  2. `onDidStartTerminalShellExecution` — knows when a new command starts
  3. `onDidEndTerminalShellExecution` — knows when a command finishes
- **Buffers** incoming data for 50ms before processing (because terminals write one character at a time sometimes — buffering groups them into full lines)
- Detects when a new command starts (1.5 second gap = new command)
- Clears the panel when a new command is detected

**Key technical term — Debouncing:**
Waiting a short time (50ms) before acting, so rapid small events get grouped into one. Like waiting until someone stops typing before searching.

**Key technical term — PTY (Pseudo Terminal):**
The fake terminal VS Code creates to run your shell. `onDidWriteTerminalData` reads directly from this.

---

### `src/logClassifier.ts` — The Brain
**What it is:** Looks at each line and decides what it is.

**What it does:**
Every line gets three labels:

**1. LogLevel** — what kind of line is it?
| Level | Example |
|-------|---------|
| `ERROR` | `[ERROR] cannot find symbol` |
| `WARN` | `npm WARN deprecated package` |
| `USER` | `console.log("my value")` |
| `STATUS` | `Server listening on port 3000` |
| `INFO` | `[INFO] Building project...` |
| `DEBUG` | `[DEBUG] connecting to database` |
| `UNKNOWN` | Anything else |

**2. LogCategory** — what category does it fall into?
| Category | Example |
|----------|---------|
| `ERROR_MESSAGE` | The error itself |
| `STACK_TRACE` | `at NotesApplication.java:26` |
| `FRAMEWORK_NOISE` | Spring Boot banner, webpack output |
| `USER_CONSOLE` | Your own print/console.log |
| `SERVER_STATUS` | "Listening on port 8080" |

**3. NoiseScore** — how noisy is it? (0 = important, 100 = pure noise)
| Score | Meaning |
|-------|---------|
| 0 | Always show (your errors, your logs) |
| 15-20 | Warnings, server status |
| 40-70 | Info, debug lines |
| 85-100 | Framework banners, blank lines, separators |

**Key technical term — RegEx (Regular Expression):**
A pattern used to match text. For example `/\bERROR\b/i` matches any line containing the word "ERROR" (case-insensitive). The classifier has ~50 of these patterns.

**Key technical term — ANSI codes:**
Special character sequences that terminals use to show colors (e.g., `\x1b[31m` = red text). The classifier strips these out to get clean text.

**Key technical term — `BUILD_TOOL_BOILERPLATE_PATTERNS`:**
Special patterns for Maven/Gradle lines that have `[ERROR]` in them but are NOT real errors — like `[ERROR] -> [Help 1]` or `[ERROR] To see the full stack trace`. These get downgraded to UNKNOWN so they don't show up as errors.

---

### `src/filterEngine.ts` — The Orchestrator
**What it is:** Combines everything and makes the final decision on what to show.

**What it does:**
- Receives raw terminal data as a string
- Splits it into lines and runs each through the classifier
- Groups stack trace lines together
- Applies the verbosity level to decide visibility
- Tracks duplicate errors and hides them
- Keeps a buffer of up to 5000 lines
- Fires events when stats change (so the UI updates)

**Verbosity levels explained:**
| Level | What you see |
|-------|-------------|
| 1 | Only errors + your console.log |
| 2 | + Warnings (default) |
| 3 | + Server status (port 3000, build complete) |
| 4 | + Info level output |
| 5 | Everything — raw unfiltered |

**Duplicate error suppression:**
When Maven prints the same error twice (once in compilation block, once in summary), the second occurrence is hidden. The first occurrence is shown once, cleanly.

**Key technical term — `FilteredEntry`:**
The data object for each line. Contains the classified line + whether it's visible + which stack group it belongs to.

**Key technical term — `Map` and `Set`:**
JavaScript data structures. `Map` stores key-value pairs (like a dictionary). `Set` stores unique values (like a list with no duplicates). Used to track error counts and suppressed groups.

**Key technical term — Callbacks / Events:**
Functions that get called when something happens. For example `onStatsChange` — when stats update, call this function to update the status bar and panel.

---

### `src/stackTraceGrouper.ts` — The Stack Trace Handler
**What it is:** Detects multi-line stack traces and groups them.

**What it does:**
When you get an error like this:
```
TypeError: Cannot read property 'name' of undefined   ← error header
    at UserService.getUser (user.js:42)               ← frame 1
    at Router.handle (router.js:17)                   ← frame 2
    at next (layer.js:95)                             ← frame 3
```

It groups all 4 lines into one `StackTraceGroup`. In the UI, this appears as a collapsible block.

**Key technical term — Stack Trace:**
When a program crashes, it prints every function call that led to the crash, from bottom to top. Each line is a "frame".

**Key technical term — `isUserCodeFrame`:**
Frames from YOUR code (e.g., `user.js:42`) vs internal framework frames (e.g., `node_modules/express/router.js`). Your code frames get priority in the display.

---

### `src/frameworkDetector.ts` — The Framework Identifier
**What it is:** Figures out what technology stack you're using.

**How it detects frameworks:**

**Static detection** (reads your project files):
- Sees `package.json` has `"next"` → Next.js project
- Sees `pom.xml` exists → Spring Boot/Java project
- Sees `manage.py` exists → Django project
- Sees `go.mod` exists → Go project

**Runtime detection** (reads terminal output):
- Sees `▲ Next.js` printed → Next.js confirmed
- Sees `:: Spring Boot ::` printed → Spring Boot confirmed

**Why it matters:** Different frameworks produce different noise patterns. A Spring Boot app has a different ASCII banner than a Next.js app. Detecting the framework lets the extension apply the right noise rules.

---

### `src/webviewPanel.ts` — The UI Panel
**What it is:** The visual panel that appears in the VS Code sidebar.

**What it does:**
- Renders as HTML/CSS/JavaScript inside VS Code
- Shows the status banner (Running / Success / Error / Warning)
- Lists all filtered log lines with color coding
- Has search, verbosity slider, level filter dropdown
- Has AI buttons (Explain Error, Summarize, Ask)
- Sends messages to the extension when you click buttons

**Key technical term — Webview:**
A mini web browser embedded inside VS Code. It runs HTML/CSS/JavaScript just like a website, but inside the editor. VS Code communicates with it by passing messages (like a chat between two programs).

**Key technical term — `postMessage` / `acquireVsCodeApi`:**
The way the webview talks to the extension. The UI posts a message like `{type: 'clearLogs'}` and the extension listens for it and responds.

**Key technical term — `pendingMessages`:**
If the panel is hidden and data arrives, messages are stored in a queue (up to 2000). When you open the panel, all queued messages are sent at once.

---

### `src/statusBar.ts` — The Status Bar
**What it is:** The row of icons at the very bottom of VS Code.

**What it shows:**
- `✓ Smart Terminal` — command completed successfully (green)
- `✗ Smart Terminal` — errors detected (red, flashes)
- `⚠ Smart Terminal` — warnings detected (yellow)
- `↻ Smart Terminal` — command is running (spinning)
- Error count badge, warning count, lines visible/total

**Key technical term — Debounced Toast:**
A popup notification that appears max once every 5 seconds even if many errors arrive at once. Prevents notification spam.

**Key technical term — Flash animation:**
When a new error arrives, the status bar flashes red 3 times (alternates between red and normal color every 350ms, 6 times total).

---

### `src/ai/provider.ts` — The AI Connector
**What it is:** A unified way to talk to Claude, OpenAI, or Ollama.

**What it does:**
- Takes a prompt, sends it to whichever AI is configured
- Returns the response
- Works the same way regardless of which AI you use

**Supported providers:**
| Provider | API endpoint | Auth |
|----------|-------------|------|
| Claude | `api.anthropic.com/v1/messages` | `x-api-key` header |
| OpenAI | `api.openai.com/v1/chat/completions` | `Bearer` token |
| Ollama | `localhost:11434/api/generate` | No auth (local) |

**Key technical term — HTTP Request:**
A message sent over the internet to an API server. Like filling out a form and submitting it — you send data, you get a response back.

**Key technical term — 30 second timeout:**
If the AI takes more than 30 seconds to respond, the request is cancelled. Prevents the extension from freezing.

---

### `src/ai/errorExplainer.ts` — AI Error Analysis
**What it does:**
1. Takes the error line + stack trace
2. Reads ~10 lines of your source code around the error location
3. Sends it all to the AI with a structured prompt
4. Parses the response into: Summary, Root Cause, Fix, Code Snippet, Confidence

**Key technical term — Path traversal guard:**
Before reading source files, it checks the path stays inside your workspace folder. This prevents a malicious log line from tricking it into reading files outside your project.

---

### `src/ai/logSummarizer.ts` — AI Log Summary
**What it does:**
Instead of sending 1000 lines to the AI (expensive), it sends a condensed version:
- First 3 lines + last 3 lines
- All error lines (max 10)
- All warning lines (max 5)
- All status events (max 5)
- Stats summary (totals)

Then the AI writes a 2-3 sentence TL;DR.

**Fallback:** If there are fewer than 10 lines or no AI is configured, it generates a summary locally using simple rules — no API call needed.

---

### `src/ai/naturalLanguageQuery.ts` — Ask a Question
**What it does:**
Lets you type questions like "show me database errors" or "what caused the crash?"

**Three-tier routing:**
1. **Question style** ("what", "why", "how", "explain") → sends to AI for conversational answer
2. **Pattern match** ("errors", "warnings", "slow queries") → uses built-in rules, no AI needed
3. **AI regex** → asks AI to generate a search pattern, applies it to logs
4. **Fallback** → simple keyword search

---

### `cli/smartlog.ts` — The CLI Tool
**What it is:** A command-line program that reads from stdin (piped input) and writes filtered output to stdout.

**Key technical term — stdin/stdout:**
- `stdin` = input stream (what gets piped into the program via `|`)
- `stdout` = output stream (what gets printed to the terminal)
- `stderr` = error stream (where the smartlog header/summary is printed, separate from filtered output)

**Key technical term — Pipe (`|`):**
Connects one program's output to another's input. `npm start | smartlog` means "take everything npm start prints, feed it into smartlog".

---

## 5. Key Technical Concepts Explained

### TypeScript
The language this project is written in. It's JavaScript but with types — meaning every variable has a defined type (string, number, boolean, etc.). TypeScript compiles to JavaScript before running.

### Interface
A TypeScript structure that defines the shape of an object. Like a blueprint.
```typescript
interface FilterStats {
  totalLines: number;   // must be a number
  errors: number;       // must be a number
  commandStatus: string; // must be a string
}
```

### Enum
A set of named constants.
```typescript
enum LogLevel {
  ERROR = 'error',
  WARN  = 'warn',
  INFO  = 'info',
}
```
Instead of using raw strings like `'error'` everywhere, you use `LogLevel.ERROR`. Safer and easier to refactor.

### Class
A blueprint for creating objects that have both data and behavior (methods).

### Async/Await
JavaScript way to handle operations that take time (like API calls) without freezing the program. `await` pauses that function until the result is ready, but other code keeps running.

### Callback
A function you pass to another function to be called later.
```typescript
engine.onStatsChange(stats => {
  statusBar.updateStats(stats); // called every time stats change
});
```

### RegEx (Regular Expression)
A pattern for matching text. Examples used in this project:
- `/\bERROR\b/i` — matches the word "ERROR" (case-insensitive)
- `/^\s+at\s+/` — matches lines starting with whitespace then "at " (stack frames)
- `/\d+:\d+:\d+/` — matches timestamps like "14:32:05"

### Map
A key-value store. `errorCounts.get('error text')` → returns how many times that error appeared.

### Set
A collection of unique values. `suppressedGroupIds.has('st-3')` → true/false.

---

## 6. How Filtering Works

### Step 1 — Classify
Every line goes through `LogClassifier` which assigns it a `LogLevel` and `noiseScore`.

### Step 2 — Apply verbosity
`FilterEngine.shouldShow()` checks the verbosity level:
- Verbosity 1: only show if level is ERROR or USER
- Verbosity 2: also show WARN
- Verbosity 3: also show STATUS
- Verbosity 4: show anything with noiseScore < 70
- Verbosity 5: show everything

### Step 3 — Deduplicate
If an ERROR line has appeared before in this command run, hide it (count > 1 → visible = false).

### Step 4 — Stack trace grouping
Stack trace continuation lines (the `at ...` frames) are grouped under their parent error. The whole group is shown or hidden together.

### Step 5 — Send to UI
Visible entries are sent to the webview panel as JSON messages.

---

## 7. AI Layer Explained

The AI features are completely optional. If no API key is set, everything still works — just without AI explanations.

```
User clicks "Explain Error"
         │
         ▼
ErrorExplainer.explain()
  - Gets the last error line from FilterEngine
  - Reads source code around the error (from your files)
  - Builds a prompt: "ERROR: ... STACK TRACE: ... SOURCE: ..."
         │
         ▼
AIProvider.complete()
  - Sends HTTP request to Claude/OpenAI/Ollama
  - Waits for response (max 30 seconds)
         │
         ▼
parseResponse()
  - Extracts ## Summary, ## Root cause, ## Fix sections
         │
         ▼
panel.sendErrorExplanation()
  - Sends result to the webview
  - UI displays it in the AI panel
```

**API keys are stored in the OS keychain** — macOS Keychain or Windows Credential Manager. They are NEVER written to any file or VS Code settings.

---

## 8. CLI vs VS Code Extension

| Feature | VS Code Extension | CLI (`smartlog`) |
|---------|-------------------|-----------------|
| Where it runs | Inside VS Code | Any terminal |
| How to use | Auto-activates | Pipe: `cmd \| smartlog` |
| UI | Visual panel with colors | Colored terminal text |
| AI features | Full panel UI | `--query` flag |
| Search | Searchbox in panel | `--query` flag |
| JSON output | No | `--json` flag |
| Summary | Status banner | `--summary` flag |
| Setup | Install extension | `npm link` |

Both use the same `LogClassifier` and `FilterEngine` — same filtering logic.

---

## 9. How to Release a New Version

### Step 1 — Make your code changes

Edit whatever files you need in `src/`.

---

### Step 2 — Test locally

Press **F5** in VS Code to open an Extension Development Host (a second VS Code window with your extension running). Test your changes there.

Or build and install via VSIX:
```bash
npm run build
npm run package
# then Cmd+Shift+P → Install from VSIX
```

---

### Step 3 — Bump the version in `package.json`

Open `package.json` and update the `"version"` field manually:
```json
"version": "0.2.1"   // was 0.2.0
```

**Version numbering rules (Semantic Versioning):**
```
MAJOR . MINOR . PATCH
  0   .   2   .   1

PATCH (0.2.0 → 0.2.1) — Bug fixes, small tweaks
MINOR (0.2.0 → 0.3.0) — New features added
MAJOR (0.2.0 → 1.0.0) — Big breaking changes
```

---

### Step 4 — Update CHANGELOG (optional but good practice)

Add a note about what changed:
```markdown
## [0.2.1] - 2026-03-25
### Fixed
- Duplicate error lines from Maven no longer shown multiple times
```

---

### Step 5 — Build

```bash
npm run build
```

This compiles TypeScript → JavaScript into the `out/` folder.

---

### Step 6 — Publish to Marketplace

```bash
vsce publish patch   # auto bumps patch version (0.2.0 → 0.2.1)
```

Or if you already updated `package.json` manually:
```bash
vsce publish
```

This will:
1. Package your extension into a `.vsix` file
2. Upload it to the VS Code Marketplace
3. Users with the extension installed will see an update notification in VS Code

---

### Step 7 — Push to GitHub

```bash
git add .
git commit -m "feat: your description here"
git push
```

---

### Full Release Checklist

```
□ Made and tested code changes
□ Bumped version in package.json
□ Ran npm run build — no errors
□ Tested with F5 or VSIX install
□ vsce publish (or vsce publish patch/minor/major)
□ git add . && git commit && git push
```

---

### Quick version reference

| Command | Old → New | Use for |
|---------|-----------|---------|
| `vsce publish patch` | 0.2.0 → 0.2.1 | Bug fixes |
| `vsce publish minor` | 0.2.0 → 0.3.0 | New features |
| `vsce publish major` | 0.2.0 → 1.0.0 | Breaking changes |
| `vsce publish` | Uses package.json version | When you set it manually |

---

*Document created: March 2026*
*Project: Smart Terminal Filter v0.2.0*
*Author: Apurva Shelar*
