# self-healing.zsh
# This script is sourced in the user's .zshrc to enable Autonomous Self-Healing CLI integration.

# Colors
SH_RED='\033[0;31m'
SH_GREEN='\033[0;32m'
SH_BLUE='\033[0;34m'
SH_CYAN='\033[0;36m'
SH_YELLOW='\033[0;33m'
SH_BOLD='\033[1m'
SH_NC='\033[0m' # No Color

LAST_CMD_FILE="/tmp/self_healing_last_cmd_$$"
LAST_FAILED_FILE="$HOME/.self-healing-failed"

# Ensure temp files exist and are writable, fallback to HOME if /tmp is not writable
touch "$LAST_CMD_FILE" 2>/dev/null || LAST_CMD_FILE="$HOME/.self_healing_last_cmd_$$"
touch "$LAST_CMD_FILE" 2>/dev/null || true

# Dynamically locate the CLI relative to this hook script
self_healing_hook_dir="$(cd "$(dirname "${(%):-%x}")" 2>/dev/null && pwd)"

# Preexec hook: Saves the command that is about to run
self_healing_preexec() {
  # Save the command (prefer alias-expanded command $2, fallback to raw $1)
  local cmd="${2:-$1}"
  printf "%s\n" "$cmd" > "$LAST_CMD_FILE"
}

# Precmd hook: Runs before the prompt is shown, checks last exit status
self_healing_precmd() {
  local exit_code=$?
  
  # Check if LAST_CMD_FILE exists and contains a command
  if [ -f "$LAST_CMD_FILE" ]; then
    local last_cmd=$(cat "$LAST_CMD_FILE")
    
    # Reset last cmd file so we don't process it again on blank presses
    echo "" > "$LAST_CMD_FILE"
    
    # Trim whitespace robustly using shell substitution
    while [[ "$last_cmd" == [[:space:]]* ]]; do last_cmd="${last_cmd#?}"; done
    while [[ "$last_cmd" == *[[:space:]] ]]; do last_cmd="${last_cmd%?}"; done
    
    # Extract the first word of the command to check for shell builtins
    local first_word="${last_cmd%% *}"
    
    # If the command failed and it's not a user interrupt, self-healing runner, dev server, or cd
    if [ $exit_code -ne 0 ] && [ $exit_code -ne 130 ] && [ $exit_code -ne 143 ] && \
       [[ -n "$last_cmd" && "$last_cmd" != *"cli/index.js"* && "$last_cmd" != "heal"* && "$last_cmd" != "npm run dev"* && "$first_word" != "cd" ]]; then
      # Save error details for the CLI tool to read
      printf "%s\n" "$last_cmd" > "$LAST_FAILED_FILE.cmd"
      printf "%s\n" "$exit_code" > "$LAST_FAILED_FILE.code"
      printf "%s\n" "$PWD" > "$LAST_FAILED_FILE.pwd"
      
      if [ -f "$HOME/.self-healing-proactive" ]; then
        echo -e "\n${SH_RED}${SH_BOLD}✘ Command failed:${SH_NC} ${SH_YELLOW}$last_cmd${SH_NC}"
        echo -e "${SH_CYAN}⚡ Proactive Daemon Mode: Auto-spawning diagnostics...${SH_NC}\n"
        if [ -n "$self_healing_hook_dir" ] && [ -f "$self_healing_hook_dir/../cli/index.js" ]; then
          node "$self_healing_hook_dir/../cli/index.js"
        else
          heal
        fi
      else
        # Print message to guide user
        echo -e "\n${SH_RED}${SH_BOLD}✘ Command failed with exit code $exit_code:${SH_NC} ${SH_YELLOW}$last_cmd${SH_NC}"
        echo -e "${SH_CYAN}💡 Run ${SH_BOLD}heal${SH_NC}${SH_CYAN} to automatically diagnose and repair this error.${SH_NC}\n"
      fi
    fi
  fi
}

# Add hooks to Zsh arrays
autoload -Uz add-zsh-hook
add-zsh-hook preexec self_healing_preexec
add-zsh-hook precmd self_healing_precmd

if [ -n "$self_healing_hook_dir" ] && [ -f "$self_healing_hook_dir/../cli/index.js" ]; then
  alias heal="node \"$self_healing_hook_dir/../cli/index.js\""
else
  alias heal="heal"
fi
