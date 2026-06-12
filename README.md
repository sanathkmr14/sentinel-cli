# Autonomous Self-Healing CLI Manager (`heal`)

An autonomous, smart terminal assistant that intercepts shell command failures, diagnoses the root causes, and automatically suggests or applies code patches and environment fixes.

Using a hybrid architecture, it blends **lightning-fast local heuristics** with **state-of-the-art LLMs** (Gemini, Claude, OpenAI, OpenRouter, and Ollama) to turn terminal frustrations into one-click resolutions.

---

## 🌟 Key Features

*   **Seamless Shell Hooks**: Integrates directly into **Zsh, Bash, Fish**, and **PowerShell** to monitor exit codes and log command output.
*   **PID-Isolated Execution**: Commands and session states are tracked dynamically on a per-tab basis using Process PIDs to prevent tab collision.
*   **Fast Local Heuristics**: Instantly resolves common errors (typos, port conflicts, missing NPM/pip modules, write permissions, git upstreams, and Docker service state) offline without API usage.
*   **LLM Diagnostics**: Automatically calls your favorite AI provider to analyze tracebacks and formulate targeted source code file edits or configuration patches.
*   **Robust State Recovery (Undo)**: Created a file patch you don't like? Revert it cleanly using the interactive scrollable undo menu (`heal undo`). Parent directories are automatically reconstructed on revert, and consumed backup files are automatically purged.
*   **Deep Security Guardrails**:
    *   **File Edit Blocklists**: Restricts modifications to system files or configuration directories (e.g. `/etc`, `/usr`, `/bin`, `C:\Windows`, `.ssh`).
    *   **Destructive Deletion Blocks**: Disallows dangerous commands (e.g. `rm -rf *`, `rm -rf .`) inside system folders and their subdirectories.
    *   **`.healignore` Config**: Ignore command patterns using comments, prefix matches, or wildcards to prevent interception of build daemons or dev servers.

---

## 🚀 Installation & Setup

Simply run the installation command inside your terminal:

```bash
# Install hooks into active shell startup profiles (e.g. .zshrc, .bashrc, config.fish, profile.ps1)
heal install
```

After installation, reload your shell configuration or open a new tab:
*   **Zsh**: `source ~/.zshrc`
*   **Bash**: `source ~/.bashrc`
*   **Fish**: `source ~/.config/fish/config.fish`
*   **PowerShell**: Restart session or reload your profile path

To remove the integration:
```bash
heal uninstall
```

---

## ⚙️ Configuration

Launch the step-by-step interactive configuration wizard:
```bash
heal config
```

### Direct CLI Configuration
You can also bypass the wizard and configure parameters directly:
```bash
heal config --provider gemini                 # Choose: gemini, claude, openrouter, openai, ollama
heal config --key YOUR_API_KEY               # Set the API key for the active provider
heal config --model gemini-2.5-flash         # Choose the target model
heal config --auto true                      # Enable / disable Autonomous Mode (auto-apply fixes)
heal config --proactive true                 # Enable / disable Proactive Mode (auto-trigger on command failure)
heal config --rules "Use strict ESM imports" # Custom instructions appended to the LLM system prompt
```

*Note: Global settings are isolated in `~/.self-healing-cli.json` and are kept separate from directory-specific `.healrc` overrides.*

---

## 🛠️ Commands Reference

| Command | Description |
| :--- | :--- |
| `heal` | Intercepts and diagnoses the last failed terminal command. |
| `heal explain` | Explains the last command error in detail without applying changes. |
| `heal undo` | Launches the interactive scrollable undo menu to revert file edits. |
| `heal status` | Shows current LLM settings, active provider, model, and prompt instructions. |
| `heal logs` | Displays the history of recently executed and resolved command diagnostics. |
| `heal stats` | Displays success rate, total runs, and performance metrics. |
| `heal install` | Detects shell startup files and hooks self-healing intercepts. |
| `heal uninstall` | Removes self-healing hook injections from profile scripts. |
| `heal version` | Displays the CLI version number. |

---

## 🔍 Local Heuristics Catalog (Offline Mode)

Your tool handles these issues instantly offline:

| Error Type | Trigger Pattern | Action |
| :--- | :--- | :--- |
| **Command Typos** | `gitt`, `npxx`, `pyton`, etc. | Automatically corrects and executes the intended command. |
| **Missing Command** | Command not found / not recognized | Suggests installation command via Homebrew, apt, curl, or NPM. |
| **Port Conflicts** | `EADDRINUSE` / Port already bound | Kills process binding the target port (`lsof` or PowerShell NetTCP). |
| **NPM Global Write** | `code EACCES` on `npm install -g` | Configures prefix to user directory (`~/.npm-global`). |
| **Missing NPM Module** | `Cannot find module '<pkg>'` | Installs package using detected manager (`npm`, `yarn`, `pnpm`, `bun`). |
| **Missing Python Module** | `ModuleNotFoundError: '<pkg>'` | Installs package mapping package name (e.g. `yaml` to `pyyaml`). |
| **Git Upstream** | `no upstream branch` | Runs `git push -u origin <current-branch>`. |
| **Docker Daemon Offline** | Connect/socket errors | Automatically launches Docker Desktop app or starts system service. |
| **Permission Denied** | Script execution EACCES | Applies execute permission (`chmod +x <file>`). |
| **PowerShell Policy** | Script running disabled | Sets policy scope to `RemoteSigned` for the current user. |

---

## 🧪 Testing

The tool includes a robust suite of unit and integration tests. Run the automated tests to verify code stability:

```bash
npm test
```

*All 32 tests check paths expansion, Windows drive parsing, folder boundaries, command overrides, hook injections, and local diagnostics.*
