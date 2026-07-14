# 🛡️ sentinel-cli (`heal`)

<p align="left">
  <img src="https://img.shields.io/badge/PROJECT-sentinel--cli-007EC6?style=for-the-badge" alt="Project Name" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white" alt="NPM" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License" />
</p>

An autonomous, smart terminal assistant that intercepts shell command failures, diagnoses the root causes, and automatically suggests or applies code patches and environment fixes. 

Using a hybrid architecture, it blends **lightning-fast local heuristics** with **state-of-the-art LLMs** (Gemini, Claude, OpenAI, OpenRouter, and Ollama) to turn terminal frustrations into one-click resolutions. Never stay stuck on a broken build or a cryptic error message again.

---

## 🌟 Key Features

*   **Seamless Shell Hooks**: Integrates directly into your favorite shells (**Zsh, Bash, Fish**, and **PowerShell**) to monitor exit codes and log command output seamlessly in the background.
*   **PID-Isolated Execution**: Commands and session states are tracked dynamically on a per-tab basis using Process PIDs to prevent tab collision and ensure context is always accurate.
*   **Fast Local Heuristics**: Instantly resolves common errors offline without any API usage. This includes typos, port conflicts, missing NPM/pip modules, write permissions, git upstreams, and Docker service state.
*   **LLM Diagnostics**: Automatically calls your favorite AI provider to deeply analyze complex tracebacks and formulate targeted source code file edits or configuration patches.
*   **Robust State Recovery (Undo)**: Created a file patch you don't like? Revert it cleanly using the interactive scrollable undo menu (`heal undo`). Parent directories are automatically reconstructed on revert, and consumed backup files are automatically purged.
*   **Deep Security Guardrails**: Built with safety in mind.
    *   **File Edit Blocklists**: Restricts modifications to critical system files or configuration directories (e.g., `/etc`, `/usr`, `/bin`, `C:\Windows`, `.ssh`).
    *   **Destructive Deletion Blocks**: Disallows dangerous commands (e.g., `rm -rf *`, `rm -rf .`) inside system folders and their subdirectories.
    *   **`.healignore` Config**: Ignore command patterns using comments, prefix matches, or wildcards to prevent interception of build daemons or dev servers.

---

## 🚀 Installation & Setup

Simply run the installation command inside your terminal to get started:

```bash
# Install hooks into active shell startup profiles (e.g. .zshrc, .bashrc, config.fish, profile.ps1)
heal install
```

After installation, reload your shell configuration or open a new terminal tab:
*   **Zsh**: `source ~/.zshrc`
*   **Bash**: `source ~/.bashrc`
*   **Fish**: `source ~/.config/fish/config.fish`
*   **PowerShell**: Restart the session or reload your profile path

To remove the integration at any time:
```bash
heal uninstall
```

---

## ⚙️ Configuration

Launch the step-by-step interactive configuration wizard for easy setup:
```bash
heal config
```

### Direct CLI Configuration
You can also bypass the wizard and configure parameters directly from the command line:

```bash
heal config --provider gemini                 # Choose: gemini, claude, openrouter, openai, ollama
heal config --key YOUR_API_KEY               # Set the API key for the active provider
heal config --model gemini-2.5-flash         # Choose the target model
heal config --auto true                      # Enable / disable Autonomous Mode (auto-apply fixes)
heal config --proactive true                 # Enable / disable Proactive Mode (auto-trigger on command failure)
heal config --rules "Use strict ESM imports" # Custom instructions appended to the LLM system prompt
```

> **Note**: Global settings are isolated in `~/.self-healing-cli.json` and are kept separate from directory-specific `.healrc` overrides.

---

## 🛠️ Commands Reference

| Command | Description |
| :--- | :--- |
| `heal` | Intercepts and diagnoses the last failed terminal command. |
| `heal explain` | Explains the last command error in detail without applying any changes. |
| `heal undo` | Launches the interactive scrollable undo menu to revert file edits safely. |
| `heal status` | Shows current LLM settings, active provider, model, and prompt instructions. |
| `heal logs` | Displays the history of recently executed and resolved command diagnostics. |
| `heal stats` | Displays success rate, total runs, and performance metrics. |
| `heal install` | Detects shell startup files and hooks self-healing intercepts. |
| `heal uninstall` | Removes self-healing hook injections from profile scripts. |
| `heal help` (`-h`) | Displays the usage instructions and commands list. |
| `heal version` | Displays the CLI version number. |

---

## 🔍 Local Heuristics Catalog (Offline Mode)

Your tool handles these common issues instantly offline, saving time and API costs:

| Error Type | Trigger Pattern | Action |
| :--- | :--- | :--- |
| **Command Typos** | `gitt`, `npxx`, `pyton`, etc. | Automatically corrects and executes the intended command. |
| **Missing Command** | Command not found / not recognized | Suggests installation command via Homebrew, apt, curl, or NPM. |
| **Port Conflicts** | `EADDRINUSE` / Port already bound | Kills process binding the target port (`lsof` or PowerShell NetTCP). |
| **NPM Global Write** | `code EACCES` on `npm install -g` | Configures prefix to user directory (`~/.npm-global`). |
| **Missing NPM Module** | `Cannot find module '<pkg>'` | Installs package using detected manager (`npm`, `yarn`, `pnpm`, `bun`). |
| **Missing Python Module** | `ModuleNotFoundError: '<pkg>'` | Installs package mapping package name (e.g., `yaml` to `pyyaml`). |
| **Git Upstream** | `no upstream branch` | Runs `git push -u origin <current-branch>`. |
| **Docker Daemon Offline** | Connect/socket errors | Automatically launches Docker Desktop app or starts system service. |
| **Permission Denied** | Script execution EACCES | Applies execute permission (`chmod +x <file>`). |
| **PowerShell Policy** | Script running disabled | Sets policy scope to `RemoteSigned` for the current user. |
| **Git Stash/Conflicts** | Unstaged changes preventing checkout/pull | Automatically offers to run `git stash` or `git commit -am "WIP"`. |
| **Missing Sudo** | `Operation not permitted` / `Permission denied` | Prompts to automatically rerun the exact same command prefixed with `sudo`. |
| **Node Version Mismatch** | `Expected version >= X.Y.Z` on `npm install` | Reads `.nvmrc` or `engines` and automatically runs `nvm use` or `nvm install`. |
| **Missing Python Venv** | `externally-managed-environment` on `pip` | Offers to create and activate a virtual environment (`python -m venv venv`). |
| **Storage Full** | `No space left on device` or `ENOSPC` | Suggests safe cleanup commands (e.g. `docker system prune`, `npm cache clean`). |
| **Lockfile Desync** | `expected yarn.lock to match package.json` | Automatically offers to run `npm install` or `yarn install` to regenerate lockfile. |
| **File Not Found** | `No such file or directory` (Typo in name) | Uses fuzzy string matching to suggest the correct similarly-named file or folder. |

---

## 🤝 Contributing

We welcome and deeply appreciate contributions from the open-source community! Whether you are fixing bugs, improving documentation, or proposing new features, your efforts help make **sentinel-cli** a better tool for everyone.

To ensure a smooth and collaborative workflow, we recommend opening an issue to discuss significant changes or new feature ideas before submitting a pull request. This helps align your work with the project's roadmap and saves everyone valuable time.

Let's connect and collaborate!

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
