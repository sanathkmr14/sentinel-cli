# self-healing.ps1
# This script is dot-sourced in the user's PowerShell profile to enable Autonomous Self-Healing CLI integration.

$LAST_FAILED_FILE = "$HOME/.self-healing-failed"
$script:self_healing_hook_dir = $PSScriptRoot
$global:self_healing_last_history_id = $null

function self_healing_prompt {
    # Capture status of last command
    $last_success = $global:?
    $exit_code = 1
    if ($global:LASTEXITCODE -ne $null) {
        $exit_code = $global:LASTEXITCODE
    }

    if (-not $last_success) {
        # Retrieve last command from history
        $history = Get-History -Count 1
        if ($history -ne $null -and $global:self_healing_last_history_id -ne $history.Id) {
            $global:self_healing_last_history_id = $history.Id
            $last_cmd = $history.CommandLine.Trim()
            
            # Avoid intercepting healer itself, node invokes, and cd commands
            $first_word = ($last_cmd -split ' ')[0]
            if ($last_cmd -and $last_cmd -notlike "*cli/index.js*" -and $last_cmd -notlike "heal*" -and $first_word -ne "cd" -and $first_word -ne "Set-Location") {
                # Save details for healer to read
                $last_cmd | Out-File -FilePath "$LAST_FAILED_FILE.cmd" -Encoding utf8 -Force
                $exit_code | Out-File -FilePath "$LAST_FAILED_FILE.code" -Encoding utf8 -Force
                $pwd.Path | Out-File -FilePath "$LAST_FAILED_FILE.pwd" -Encoding utf8 -Force

                $proactive_file = "$HOME/.self-healing-proactive"
                if (Test-Path $proactive_file) {
                    Write-Host ""
                    Write-Host "✘ Command failed: $last_cmd" -ForegroundColor Red
                    Write-Host "⚡ Proactive Daemon Mode: Auto-spawning diagnostics..." -ForegroundColor Cyan
                    Write-Host ""
                    heal
                } else {
                    Write-Host ""
                    Write-Host "✘ Command failed with exit code $exit_code: $last_cmd" -ForegroundColor Red
                    Write-Host "💡 Run " -NoNewline -ForegroundColor Cyan
                    Write-Host "heal" -NoNewline -ForegroundColor Cyan
                    Write-Host " to automatically diagnose and repair this error." -ForegroundColor Cyan
                    Write-Host ""
                }
            }
        }
    }

    # Standard PowerShell prompt behavior (or fallback if original prompt is defined)
    "PS $($pwd.Path)> "
}

# Override prompt function safely
if ((Get-Command prompt -ErrorAction SilentlyContinue) -and (Get-Command prompt).ScriptBlock -notlike "*self_healing_prompt*") {
    Set-Content -Path function:prompt -Value {
        self_healing_prompt
    }
}

# Dynamic relative hook path resolution for the heal wrapper
function heal {
    if ($script:self_healing_hook_dir) {
        node "$script:self_healing_hook_dir/../cli/index.js" $args
    } else {
        node "heal" $args
    }
}
