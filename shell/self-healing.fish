# self-healing.fish
# This script is sourced in the user's config.fish to enable Autonomous Self-Healing CLI integration.

# Colors
set -g SH_RED '\033[0;31m'
set -g SH_GREEN '\033[0;32m'
set -g SH_BLUE '\033[0;34m'
set -g SH_CYAN '\033[0;36m'
set -g SH_YELLOW '\033[0;33m'
set -g SH_BOLD '\033[1m'
set -g SH_NC '\033[0m' # No Color

set -g LAST_CMD_FILE "/tmp/self_healing_last_cmd_$fish_pid"
set -g LAST_FAILED_FILE "$HOME/.self-healing-failed"

# Ensure temp files exist and are writable, fallback to HOME if /tmp is not writable
touch "$LAST_CMD_FILE" 2>/dev/null; or set -g LAST_CMD_FILE "$HOME/.self_healing_last_cmd_$fish_pid"
touch "$LAST_CMD_FILE" 2>/dev/null || true

# Dynamically locate the CLI relative to this hook script
set -g self_healing_hook_dir (cd (dirname (status current-filename)) 2>/dev/null && pwd)

# Preexec hook: Saves the command that is about to run
function self_healing_preexec --on-event fish_preexec
    echo "$argv[1]" > "$LAST_CMD_FILE"
end

# Postexec hook: Runs after a command finishes, checks exit status
function self_healing_postexec --on-event fish_postexec
    set -l exit_code $status
    
    # Check if LAST_CMD_FILE exists and contains a command
    if test -f "$LAST_CMD_FILE"
        set -l last_cmd (cat "$LAST_CMD_FILE")
        
        # Reset last cmd file
        echo "" > "$LAST_CMD_FILE"
        
        # Trim whitespace
        set -l last_cmd (string trim "$last_cmd")
        
        if test -z "$last_cmd"
            return
        end
        
        # Extract the first word of the command to check for shell builtins
        set -l first_word (string split -m 1 " " "$last_cmd")[1]
        
        # If the command failed and it's not a user interrupt, self-healing runner, dev server, or cd
        if test $exit_code -ne 0; and test $exit_code -ne 130; and test $exit_code -ne 143; and not string match -q "*cli/index.js*" "$last_cmd"; and not string match -q "heal*" "$last_cmd"; and not string match -q "npm run dev*" "$last_cmd"; and test "$first_word" != "cd"
            # Save error details for the CLI tool to read
            echo "$last_cmd" > "$LAST_FAILED_FILE.cmd"
            echo "$exit_code" > "$LAST_FAILED_FILE.code"
            echo "$PWD" > "$LAST_FAILED_FILE.pwd"
            
            if test -f "$HOME/.self-healing-proactive"
                echo -e "\n$SH_RED$SH_BOLD✘ Command failed:$SH_NC $SH_YELLOW$last_cmd$SH_NC"
                echo -e "$SH_CYAN⚡ Proactive Daemon Mode: Auto-spawning diagnostics...$SH_NC\n"
                if test -n "$self_healing_hook_dir"; and test -f "$self_healing_hook_dir/../cli/index.js"
                    node "$self_healing_hook_dir/../cli/index.js"
                else
                    heal
                end
            else
                # Print message to guide user
                echo -e "\n$SH_RED$SH_BOLD✘ Command failed with exit code $exit_code:$SH_NC $SH_YELLOW$last_cmd$SH_NC"
                echo -e "$SH_CYAN💡 Run $SH_BOLD"heal"$SH_NC$SH_CYAN to automatically diagnose and repair this error.$SH_NC\n"
            end
        end
    end
end

if test -n "$self_healing_hook_dir"; and test -f "$self_healing_hook_dir/../cli/index.js"
    alias heal="node \"$self_healing_hook_dir/../cli/index.js\""
else
    alias heal="heal"
end
