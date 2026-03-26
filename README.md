# Smart Terminal Filter

**Stop scrolling through terminal noise. See only what matters.**

Smart Terminal Filter is a VS Code extension that acts like a smart filter for your terminal. It automatically separates the important output - errors, warnings, your own logs - from all the noise, so you can focus on your code instead of reading through hundreds of irrelevant lines.

---

## Why you need this

Every time you run `npm start`, `python manage.py runserver`, or `docker compose up`, your terminal floods with hundreds of lines you never asked for - Next.js banners, webpack progress bars, Spring Boot ASCII art, npm install logs. The one actual error that matters is buried somewhere in the middle.

Smart Terminal Filter fixes this automatically, with zero configuration.

---

## Features

### Intelligent Noise Filtering
Automatically hides framework boilerplate and build system noise across **8 frameworks** and **10+ languages** while keeping your errors, warnings, and `console.log` output front and center.

### Verbosity Control
A single slider gives you 5 levels of detail:

| Level | Shows |
|---|---|
| 1 | Errors only |
| 2 | Errors + Warnings (default) |
| 3 | + Server status messages |
| 4 | + Verbose / info output |
| 5 | Everything (raw) |

### Command Status Banner
A persistent banner at the top of the panel shows the current state of your terminal at a glance — **Running**, **Success**, **Warning**, or **Error** - so you always know what happened without reading a single line.

### Stack Trace Grouping
Multi-line stack traces are collapsed into a single expandable block with a frame count and source file. Click to expand. Click the arrow to jump directly to the error line in your code.

### Error Trend Detection
If the same error appears multiple times across runs, it gets a badge - **↻ 2nd time**, **↻ 3rd time** - or so recurring problems are immediately obvious.

### Framework Auto-Detection
Automatically detects your project type by reading `package.json`, `manage.py`, `pom.xml`, and other config files, then applies the right noise/signal rules for that stack. Supported frameworks:

- Next.js / React (CRA + Vite)
- Express / Node.js
- Django / Python
- Spring Boot / Java
- Ruby on Rails
- Docker / Docker Compose
- Go

### Custom Patterns
Add your own regex patterns to always hide or always show specific output:

```json
"smartTerminal.customNoisePatterns": ["^\\[HMR\\]", "^webpack compiled"],
"smartTerminal.customSignalPatterns": ["payment", "order.*created"]
```

### AI-Powered Tools *(optional)*
Connect Claude or OpenAI or Ollama to unlock three AI features inside the panel:

- **Explain Error**: plain-English breakdown of what went wrong, why, and how to fix it, with a code snippet
- **Summarize**: 2–3 sentence summary of the entire run with key events listed
- **Ask**: natural language queries like *"show me slow database queries"* or *"what caused the crash?"*

### Standalone CLI
Filter logs outside VS Code by piping through `smartlog`:

```bash
npm start | smartlog
docker logs my-container | smartlog -v 3
python app.py 2>&1 | smartlog --summary
```

---

## Demo

### Error Detection
![Error Detection Demo](images/ErrorMessageDemo.gif)

### Success State
![Success State Demo](images/SuccessMessageDemo.gif)

---

## Installation

Install from the VS Code Marketplace:

1. Open VS Code
2. Press `Cmd+Shift+X` (Mac) / `Ctrl+Shift+X` (Windows/Linux)
3. Search **Smart Terminal Filter**
4. Click **Install**

The extension activates automatically on startup - no configuration needed to start filtering.

---

## Opening the Panel

| Method | Action |
|---|---|
| Keyboard shortcut | `Cmd+Shift+L` (Mac) / `Ctrl+Shift+L` (Windows/Linux) |
| Command Palette | `Cmd+Shift+P` → **Smart Terminal: Open Filtered Log Panel** |

The panel appears alongside your terminal. Run any command and filtered output appears immediately.

---

## Setting Up AI Features

AI features require an API key from Claude (Anthropic) or OpenAI. Your key is stored securely in the **OS keychain** (macOS Keychain / Windows Credential Manager) - never in any settings file.

### Step 1: Choose your provider

Open VS Code Settings (`Cmd+,`) and set:

```
smartTerminal.ai.provider → claude   (or openai / ollama)
```

### Step 2: Add your API key

Open the Command Palette (`Cmd+Shift+P`) and run:

```
Smart Terminal: Set AI API Key
```

A password input box will appear. Paste your key and press Enter. Done.

**Where to get API keys:**
- **Claude**: [console.anthropic.com](https://console.anthropic.com) → API Keys
- **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Ollama**: No key needed. Just set the provider to `ollama` and make sure Ollama is running locally.

### Removing your API key

```
Smart Terminal: Clear AI API Key
```

---

## All Commands

| Command | Description |
|---|---|
| `Smart Terminal: Open Filtered Log Panel` | Open the panel |
| `Smart Terminal: Clear All Logs` | Clear the log view |
| `Smart Terminal: Toggle Log Capture` | Pause / resume capturing terminal output |
| `Smart Terminal: Set Verbosity Level` | Pick verbosity 1–5 via quick pick |
| `Smart Terminal: Export Filtered Logs` | Open filtered logs in a new editor tab |
| `Smart Terminal: Set AI API Key` | Securely save your API key to the OS keychain |
| `Smart Terminal: Clear AI API Key` | Remove the stored API key |
| `Smart Terminal: AI — Explain Last Error` | AI explanation of the most recent error |
| `Smart Terminal: AI — Summarize Recent Logs` | AI summary of the current run |
| `Smart Terminal: AI — Ask a Question About Logs` | Natural language log query |

---

## Configuration Reference

| Setting | Default | Description |
|---|---|---|
| `smartTerminal.verbosityLevel` | `2` | Verbosity level 1–5 |
| `smartTerminal.maxLogLines` | `5000` | Max lines retained in memory |
| `smartTerminal.frameworkDetection` | `true` | Auto-detect project framework |
| `smartTerminal.collapseStackTraces` | `true` | Collapse stack traces into expandable blocks |
| `smartTerminal.highlightUserLogs` | `true` | Highlight console.log / print output |
| `smartTerminal.customNoisePatterns` | `[]` | Regex patterns to always hide |
| `smartTerminal.customSignalPatterns` | `[]` | Regex patterns to always show |
| `smartTerminal.ai.provider` | `claude` | AI provider: `claude`, `openai`, or `ollama` |
| `smartTerminal.ai.model` | *(provider default)* | Override the model name |
| `smartTerminal.ai.baseUrl` | *(provider default)* | Custom base URL (for Ollama or proxies) |

---

## Languages & Frameworks Supported

**Noise filtering for:** JavaScript, TypeScript, Python, Ruby, Java, Go, Rust, C#, PHP, Docker

**Stack trace detection for:** Node.js, Python, Ruby, Java, Go, Rust, C#, PHP

**Framework presets for:** Next.js, React (CRA/Vite), Express, Django, Spring Boot, Rails, Docker, Go

---

## Privacy

- Your logs never leave your machine unless you explicitly use an AI feature
- AI features send only the relevant error lines and stack trace to the API — not your full log history
- API keys are stored in the OS keychain, not in VS Code settings or any file

---

## License

MIT

