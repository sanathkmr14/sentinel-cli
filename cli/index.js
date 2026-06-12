#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const readline = require('readline');
const https = require('https');
const http = require('http');
const os = require('os');

// Paths & Constants
const CONFIG_PATH = path.join(os.homedir() || process.env.HOME || process.env.USERPROFILE || '.', '.self-healing-cli.json');
const LAST_FAILED_FILE = path.join(os.homedir() || process.env.HOME || process.env.USERPROFILE || '.', '.self-healing-failed');
const HISTORY_FILE = path.join(os.homedir() || process.env.HOME || process.env.USERPROFILE || '.', '.self-healing-history.json');
const PROACTIVE_FILE = path.join(os.homedir() || process.env.HOME || process.env.USERPROFILE || '.', '.self-healing-proactive');
const BACKUP_DIR = path.join(os.homedir() || process.env.HOME || process.env.USERPROFILE || '.', '.self-healing-backups');

// ANSI Color Codes (Premium 256-color palette)
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';

const RED = '\x1b[38;5;203m';       // Coral Red
const GREEN = '\x1b[38;5;120m';     // Light Pastel Green
const YELLOW = '\x1b[38;5;222m';    // Warm Yellow
const BLUE = '\x1b[38;5;111m';      // Soft Sky Blue
const MAGENTA = '\x1b[38;5;176m';   // Lavender Magenta
const CYAN = '\x1b[38;5;117m';      // Light Cyan
const GRAY = '\x1b[38;5;246m';      // Slate Gray
const DARK_GRAY = '\x1b[38;5;240m'; // Charcoal Gray
const WHITE = '\x1b[37m';

// Logging Helpers
function logSuccess(msg) {
  console.log(`${GREEN}✔ ${BOLD}${msg}${RESET}`);
}

function logError(msg) {
  console.log(`${RED}✘ ${BOLD}${msg}${RESET}`);
}

function logInfo(msg) {
  console.log(`${BLUE}ℹ${RESET} ${msg}`);
}

function logHeader(msg) {
  console.log(`\n${MAGENTA}${BOLD}⚡ ${msg} ⚡${RESET}\n`);
}

// Helper: Wrap text at word boundaries to fit console width
function wrapText(text, maxLen = 70) {
  if (!text) return [];
  const paragraphs = text.split('\n');
  const result = [];
  for (const para of paragraphs) {
    if (para.trim() === '') {
      result.push('');
      continue;
    }
    const words = para.split(' ');
    let currentLine = '';
    for (const word of words) {
      const spaceNeeded = currentLine ? 1 : 0;
      if (stripAnsi(currentLine).length + spaceNeeded + stripAnsi(word).length > maxLen) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }
  return result;
}

// Helper: Truncate logs smartly if they exceed a size threshold
function truncateLogs(logText, maxLines = 100) {
  if (!logText) return '';
  const lines = logText.split('\n');
  if (lines.length <= maxLines) {
    return logText;
  }
  
  const headLines = Math.floor(maxLines * 0.2); // 20% from start
  const tailLines = maxLines - headLines - 1;   // Remaining from end
  
  const head = lines.slice(0, headLines);
  const tail = lines.slice(lines.length - tailLines);
  
  return [
    ...head,
    `\n--- [ ... OUTPUT TRUNCATED FOR DIAGNOSTICS (${lines.length - maxLines} lines hidden) ... ] ---\n`,
    ...tail
  ].join('\n');
}

// Helper: Strip ANSI codes for length calculation
function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Helper: Draw box around content
function drawBox(title, lines, color = MAGENTA) {
  const width = Math.max(60, title.length + 8, ...lines.map(l => stripAnsi(l).length + 4));
  const borderTop = color + '╭' + '─' + BOLD + ' ' + title + ' ' + RESET + color + '─'.repeat(width - title.length - 4) + '╮' + RESET;
  const borderBottom = color + '╰' + '─'.repeat(width - 2) + '╯' + RESET;
  
  console.log(borderTop);
  for (const line of lines) {
    const rawLen = stripAnsi(line).length;
    const padding = ' '.repeat(width - rawLen - 4);
    console.log(color + '│ ' + RESET + line + padding + color + ' │' + RESET);
  }
  console.log(borderBottom);
}

// Helper: Animated Spinner / Loader
function startSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  process.stdout.write('\x1b[?25l'); // Hide cursor
  process.stdout.write(`${CYAN}${frames[0]}${RESET} ${message}`);
  
  const timer = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${CYAN}${frames[i]}${RESET} ${message}`);
  }, 80);
  
  return {
    stop: (success = true, finalMessage = '') => {
      clearInterval(timer);
      process.stdout.write('\r\x1b[K'); // Clear line
      process.stdout.write('\x1b[?25h'); // Show cursor
      if (finalMessage) {
        const icon = success ? `${GREEN}✔${RESET}` : `${RED}✘${RESET}`;
        console.log(`${icon} ${finalMessage}`);
      }
    },
    update: (newMessage) => {
      message = newMessage;
    }
  };
}

// Helper: Interactive scroll-and-select list in terminal raw mode
function selectOption(promptMessage, options, defaultIndex = 0) {
  const stdin = process.stdin;
  
  if (options.length === 0) {
    return Promise.resolve(-1);
  }

  // If not a TTY, fall back to standard text prompt question
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return new Promise(async (resolve) => {
      console.log(promptMessage);
      for (let i = 0; i < options.length; i++) {
        console.log(`  ${i + 1}) ${options[i]}`);
      }
      const defaultText = options[defaultIndex];
      const answer = await askQuestion(`Choose option (1-${options.length}) [default: ${defaultText}]: `);
      const num = parseInt(answer.trim());
      if (num >= 1 && num <= options.length) {
        resolve(num - 1);
      } else {
        resolve(defaultIndex);
      }
    });
  }

  return new Promise((resolve) => {
    let selectedIndex = defaultIndex;
    const stdout = process.stdout;

    // Save current terminal settings and setup raw mode
    const isRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    // Hide cursor
    stdout.write('\x1b[?25l');

    function render() {
      stdout.write(`${promptMessage}\n`);
      for (let i = 0; i < options.length; i++) {
        if (i === selectedIndex) {
          stdout.write(`  ${GREEN}❯ ${BOLD}${options[i]}${RESET}\n`);
        } else {
          stdout.write(`    ${DIM}${options[i]}${RESET}\n`);
        }
      }
    }

    function clear() {
      const lineCount = options.length + 1;
      for (let i = 0; i < lineCount; i++) {
        stdout.write('\x1b[1A\x1b[2K'); // Up 1 line, clear line
      }
    }

    render();

    function onKeypress(str, key) {
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(130);
      } else if (key && (key.name === 'return' || key.name === 'enter')) {
        cleanup();
        resolve(selectedIndex);
      } else if (key && key.name === 'up') {
        clear();
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key && key.name === 'down') {
        clear();
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (str >= '1' && str <= String(options.length)) {
        const num = parseInt(str) - 1;
        clear();
        selectedIndex = num;
        render();
      }
    }

    function cleanup() {
      stdout.write('\x1b[?25h'); // Show cursor
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(isRaw);
      stdin.pause();
    }

    stdin.on('keypress', onKeypress);
  });
}

// Helper: 3-second abortable countdown for autonomous execution
function startAutonomyCountdown() {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let count = 3;
    const isRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    // Hide cursor during countdown
    process.stdout.write('\x1b[?25l');
    process.stdout.write(`\r🤖 ${GREEN}Autonomous Mode:${RESET} Executing fix script in ${BOLD}${count}${RESET} seconds... (Press any key to abort)`);

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        cleanup(true);
      } else {
        process.stdout.write(`\r🤖 ${GREEN}Autonomous Mode:${RESET} Executing fix script in ${BOLD}${count}${RESET} seconds... (Press any key to abort)`);
      }
    }, 1000);

    function onKeypress(str, key) {
      if (key && key.ctrl && key.name === 'c') {
        cleanup(false);
        process.exit(130);
      }
      cleanup(false);
    }

    function cleanup(proceed) {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K'); // Clear line
      process.stdout.write('\x1b[?25h'); // Show cursor
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(isRaw);
      stdin.pause();
      resolve(proceed);
    }

    stdin.on('keypress', onKeypress);
  });
}

// Command blocklist for security
const SECURITY_BLOCKLIST = [
  'rm -rf /',
  'rm -rf ~',
  'sudo rm',
  'mkfs',
  'dd if=',
  ':(){:|:&};:', // fork bomb
  'chmod 777 /',
  'chown -R',
  'shutdown',
  'reboot'
];

// Helper: Read Config
function readConfig(globalOnly = false) {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {}
  }
  
  if (globalOnly) {
    return config;
  }
  
  // Merge project-specific config if exists
  const localConfigPath = path.join(process.cwd(), '.healrc');
  if (fs.existsSync(localConfigPath)) {
    try {
      const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      config = { ...config, ...localConfig };
    } catch (e) {}
  }
  return config;
}

// Helper: Write Config
function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// Helper: Ask Question
let globalRl;
function askQuestion(query) {
  if (!globalRl) {
    globalRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    globalRl.on('close', () => {
      globalRl = null;
    });
  }
  return new Promise((resolve) => {
    try {
      globalRl.question(query, (ans) => {
        resolve(ans);
      });
    } catch (e) {
      resolve('');
    }
  });
}

function closeReadline() {
  if (globalRl) {
    globalRl.close();
    globalRl = null;
  }
}

// Helper: Detect active Package Manager
function getPackageManager(dir) {
  let currentDir = dir || process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(currentDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(currentDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(currentDir, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(currentDir, 'package-lock.json'))) return 'npm';
    
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return 'npm';
}

// Python module name to pip package name mapping
const PYTHON_PIP_MAPPING = {
  'yaml': 'pyyaml',
  'dotenv': 'python-dotenv',
  'jwt': 'pyjwt',
  'cv2': 'opencv-python',
  'bs4': 'beautifulsoup4',
  'PIL': 'pillow',
  'sklearn': 'scikit-learn',
  'sqlite3': 'pysqlite3',
  'psycopg2': 'psycopg2-binary'
};

// Security verification
function isCommandSafe(cmd, pwd) {
  if (!cmd) return false;
  const cleanCmd = cmd.trim().toLowerCase().replace(/\s+/g, ' ');

  // Custom check for rm -rf targeting system directories
  if (cleanCmd.includes('rm -rf ')) {
    const parts = cleanCmd.split('rm -rf ');
    for (let i = 1; i < parts.length; i++) {
      const target = parts[i].split(' ')[0].trim();
      const systemRoots = ['/', '/etc', '/var', '/bin', '/sbin', '/usr', '/system', '/private', '/private/etc', '/private/var', '/private/bin', '/private/sbin', '/private/usr'];
      if (systemRoots.includes(target) || 
          target === '~' || 
          target.startsWith('/etc/') || 
          target.startsWith('/var/') || 
          target.startsWith('/bin/') || 
          target.startsWith('/sbin/') || 
          target.startsWith('/usr/') || 
          target.startsWith('/system/') || 
          target.startsWith('/private/')) {
        return false;
      }
    }
  }

  // Check the rest of the blocklist (excluding 'rm -rf /' and 'rm -rf ~')
  const otherBlocklist = [
    'sudo rm',
    'mkfs',
    'dd if=',
    ':(){:|:&};:', // fork bomb
    'chmod 777 /',
    'chown -R',
    'shutdown',
    'reboot'
  ];
  for (const block of otherBlocklist) {
    if (cleanCmd.includes(block)) {
      return false;
    }
  }

  // Prevent destructive commands on root/system folders
  if (cleanCmd.includes('rm ')) {
    const pwdClean = (pwd || '').replace(/\\/g, '/').trim();
    const systemRoots = [
      '/', '/etc', '/var', '/bin', '/sbin', '/usr', '/system', '/private',
      '/windows', '/winnt', '/program files', '/program files (x86)'
    ];
    const isSystemPwd = systemRoots.some(root => {
      const lowerPwd = pwdClean.toLowerCase();
      const lowerRoot = root.toLowerCase();
      if (lowerRoot === '/') {
        return lowerPwd === '/';
      }
      return lowerPwd === lowerRoot || lowerPwd.startsWith(lowerRoot + '/');
    });
    if (isSystemPwd) {
      const normalizedCmd = cleanCmd.replace(/\s+/g, ' ');
      if (normalizedCmd.includes('rm -rf .') || normalizedCmd.includes('rm -rf *') || normalizedCmd.includes('rm -rf ..')) {
        return false;
      }
    }
  }
  return true;
}

// Helper: Check if command matches .healignore configuration
function shouldIgnoreCommand(cmd, pwd) {
  if (!cmd) return false;
  
  const searchDirs = [];
  if (pwd) searchDirs.push(pwd);
  searchDirs.push(os.homedir() || process.env.HOME || process.env.USERPROFILE || '.');
  
  let ignoreContent = '';
  for (const dir of searchDirs) {
    const ignorePath = path.join(dir, '.healignore');
    if (fs.existsSync(ignorePath)) {
      try {
        ignoreContent = fs.readFileSync(ignorePath, 'utf8');
        break; // Use the first one we find
      } catch (e) {}
    }
  }
  
  if (!ignoreContent) return false;
  
  const lines = ignoreContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
    
  const cleanCmd = cmd.trim();
  
  for (const pattern of lines) {
    if (pattern.includes('*') || pattern.includes('?')) {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const regexStr = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
      try {
        const regex = new RegExp(regexStr, 'i');
        if (regex.test(cleanCmd)) return true;
      } catch (e) {}
    } else {
      if (cleanCmd.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }
  
  return false;
}

// Local offline heuristics engine
function runLocalDiagnostics(command, exitCode, output) {
  // 0. Network Connection / DNS Offline Detection
  if (output.includes('ENOTFOUND') || 
      output.includes('EAI_AGAIN') || 
      output.includes('could not resolve host') || 
      output.includes('getaddrinfo') || 
      output.includes('network is unreachable')) {
    return {
      category: 'environment',
      rootCause: 'System is offline or DNS resolution failed.',
      explanation: 'Your command failed because it requires an active internet connection, and the network or DNS is currently unreachable.',
      suggestedFix: '',
      canAutoHeal: false
    };
  }

  // 0.1 Out of Disk Space Detection
  if (output.match(/No space left on device/i) || 
      output.match(/disk quota exceeded/i) || 
      output.includes('ENOSPC')) {
    return {
      category: 'environment',
      rootCause: 'Disk space is full.',
      explanation: 'The system has run out of disk space or exceeded your disk quota. You must free up some space to run this command.',
      suggestedFix: 'df -h && du -sh * 2>/dev/null | sort -hr | head -n 10',
      canAutoHeal: false
    };
  }

  // 0.2 NPM Global Permission Errors (EACCES)
  if (output.includes('code EACCES') || 
      (output.includes('permission denied') && output.includes('node_modules'))) {
    return {
      category: 'permission',
      rootCause: 'NPM global write permissions error (EACCES).',
      explanation: 'Your global NPM installation failed due to insufficient write permissions in system folders. Reconfiguring NPM to use a user-owned directory is recommended.',
      suggestedFix: "mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global'",
      canAutoHeal: true
    };
  }

  // 1. Missing NPM module
  let match = output.match(/Cannot find module '([^']+)'/) || 
              output.match(/Error: Cannot find module '([^']+)'/) ||
              output.match(/Cannot find package '([^']+)'/);
  if (match) {
    const pkg = match[1];
    const pm = getPackageManager(process.cwd());
    const installCmd = pm === 'yarn' ? `yarn add ${pkg}` : (pm === 'pnpm' ? `pnpm add ${pkg}` : (pm === 'bun' ? `bun add ${pkg}` : `npm install ${pkg}`));
    return {
      category: 'missing_dependency',
      rootCause: `The dependency '${pkg}' is not installed.`,
      explanation: `Your script tried to import or require '${pkg}', but it's not present in your node_modules directory.`,
      suggestedFix: installCmd,
      canAutoHeal: true
    };
  }

  // 2. Command not found (typos)
  match = output.match(/command not found:\s*(\S+)/i) || 
          output.match(/(\S+):\s*command not found/i) || 
          output.match(/(\S+)\s*is not recognized as an internal/i) ||
          output.match(/The term '([^']+)' is not recognized/i);
  if (match) {
    const failedCmd = match[1] || command.split(' ')[0];
    let suggestion = '';
    if (failedCmd === 'gitt' || failedCmd === 'gt') suggestion = 'git';
    else if (failedCmd === 'npxx') suggestion = 'npx';
    else if (failedCmd === 'npms' || failedCmd === 'npmm') suggestion = 'npm';
    else if (failedCmd === 'dockerr') suggestion = 'docker';
    else if (failedCmd === 'pyton' || failedCmd === 'py') suggestion = 'python3';
    
    if (suggestion) {
      const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|\\s)${escapeRegExp(failedCmd)}(?=\\s|$)`, 'g');
      const fixedFullCmd = command.replace(regex, `$1${suggestion}`);
      return {
        category: 'typo',
        rootCause: `Command typo: '${failedCmd}' instead of '${suggestion}'.`,
        explanation: `The command '${failedCmd}' was not found. It looks like a simple typing error.`,
        suggestedFix: fixedFullCmd,
        canAutoHeal: true
      };
    } else {
      const isMac = process.platform === 'darwin';
      let installerFix = `brew install ${failedCmd} || npm install -g ${failedCmd}`;
      if (failedCmd === 'go') {
        installerFix = isMac ? 'brew install go' : 'sudo apt install -y golang';
      } else if (failedCmd === 'rustc' || failedCmd === 'cargo') {
        installerFix = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh";
      } else if (failedCmd === 'pip3' || failedCmd === 'pip') {
        installerFix = isMac ? 'python3 -m ensurepip' : 'sudo apt install -y python3-pip';
      } else if (failedCmd === 'node') {
        installerFix = isMac ? 'brew install node' : 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash';
      }
      return {
        category: 'typo',
        rootCause: `Command executable '${failedCmd}' not found.`,
        explanation: `The executable '${failedCmd}' is not installed or not in your system PATH.`,
        suggestedFix: installerFix,
        canAutoHeal: false
      };
    }
  }

  // 3. Port in use
  match = output.match(/EADDRINUSE.*:(\d+)/) || 
          output.match(/port (\d+) is already in use/i) || 
          output.match(/address already in use (?:.*:)?(\d+)/);
  if (match) {
    const port = match[1];
    const suggestedFix = process.platform === 'win32'
      ? `powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force"`
      : `lsof -t -i:${port} | xargs kill -9`;
    return {
      category: 'port_conflict',
      rootCause: `Port ${port} is already in use by another local process.`,
      explanation: `Your application failed to bind to port ${port} because another local running service is holding it.`,
      suggestedFix: suggestedFix,
      canAutoHeal: true
    };
  }

  // 4. Git upstream branch
  if (output.includes('has no upstream branch') || output.includes('push --set-upstream')) {
    const gitMatch = output.match(/git push --set-upstream origin (\S+)/);
    const suggestedFix = gitMatch ? gitMatch[0] : 'git push -u origin $(git branch --show-current)';
    return {
      category: 'git_conflict',
      rootCause: 'No upstream branch configured for the current local branch.',
      explanation: 'You are trying to push a new local branch that does not exist on the remote Git origin yet.',
      suggestedFix: suggestedFix,
      canAutoHeal: true
    };
  }
  
  // 4.1 Git SSH permission denied
  if (output.includes('Permission denied (publickey)') && 
      (output.includes('git@github.com') || output.includes('git@gitlab.com') || output.includes('Could not read from remote repository'))) {
    let httpsFix = '';
    try {
      const gitRemoteUrl = execSync('git remote get-url origin', { stdio: 'pipe' }).toString().trim();
      let httpsUrl = gitRemoteUrl;
      if (httpsUrl.startsWith('git@')) {
        httpsUrl = httpsUrl.replace(/^git@([^:]+):/, 'https://$1/');
      } else if (httpsUrl.startsWith('ssh://git@')) {
        httpsUrl = httpsUrl.replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/');
      }
      if (httpsUrl !== gitRemoteUrl) {
        httpsFix = `git remote set-url origin ${httpsUrl}`;
      }
    } catch (e) {}
    
    return {
      category: 'permission',
      rootCause: 'Git SSH authentication failed (Permission denied (publickey)).',
      explanation: 'Your SSH key is not added to your Git provider or your SSH agent is not loaded. Switching the remote URL from SSH (git@...) to HTTPS (https://...) allows you to push using token or credential helper authentication.',
      suggestedFix: httpsFix || 'ssh-add -l || ssh-add ~/.ssh/id_rsa',
      canAutoHeal: !!httpsFix
    };
  }

  // 4.2 Git remote already exists
  if (output.includes('remote origin already exists') || output.includes('remote already exists')) {
    const gitMatch = command.match(/git remote add (\S+) (\S+)/);
    if (gitMatch) {
      const remoteName = gitMatch[1];
      const remoteUrl = gitMatch[2];
      const fixedFix = command.replace(`git remote add ${remoteName} ${remoteUrl}`, `git remote set-url ${remoteName} ${remoteUrl}`);
      return {
        category: 'git_conflict',
        rootCause: `Git remote '${remoteName}' already exists.`,
        explanation: `You tried to configure the remote '${remoteName}', but it is already configured. We can update its URL to '${remoteUrl}' instead.`,
        suggestedFix: fixedFix,
        canAutoHeal: true
      };
    }
  }

  // 5. Node engine version mismatch
  if (output.includes('Unsupported engine') || output.includes('requires Node.js')) {
    match = output.match(/requires Node\.js\s*([^\s]+)/) || output.match(/Expected version:\s*([^\s]+)/);
    const version = match ? match[1] : '';
    return {
      category: 'environment_mismatch',
      rootCause: 'Node.js version mismatch.',
      explanation: 'The project configuration requires a different version of Node.js than your active environment.',
      suggestedFix: version ? `nvm install ${version.replace(/[^0-9.]/g, '')} && nvm use ${version.replace(/[^0-9.]/g, '')}` : 'nvm use && node -v',
      canAutoHeal: false // nvm is a shell function and cannot be easily invoked via a Node child process directly
    };
  }

  // 6. Python Missing Dependency (ModuleNotFoundError or ImportError)
  match = output.match(/ModuleNotFoundError:\s*No module named '([^']+)'/) ||
          output.match(/ImportError:\s*No module named\s+(\S+)/);
  if (match) {
    const pkg = match[1];
    const pipPkg = PYTHON_PIP_MAPPING[pkg] || pkg;
    return {
      category: 'missing_dependency',
      rootCause: `The Python module '${pkg}' is not installed.`,
      explanation: `Your script tried to import '${pkg}', but it's not present in your active Python environment.`,
      suggestedFix: `pip3 install ${pipPkg} || pip install ${pipPkg}`,
      canAutoHeal: true
    };
  }

  // 7. Docker Daemon Offline
  if (output.includes('Cannot connect to the Docker daemon') || 
      output.includes('docker daemon is not running') || 
      output.includes('Is the docker daemon running')) {
    let suggestedFix = 'sudo systemctl start docker';
    if (process.platform === 'win32') {
      suggestedFix = `powershell -Command "Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'"`;
    } else if (process.platform === 'darwin') {
      suggestedFix = 'open --background -a Docker';
    }
    return {
      category: 'environment',
      rootCause: 'Docker daemon is not running.',
      explanation: 'Your command failed because it could not connect to the local Docker service. You need to start the Docker daemon first.',
      suggestedFix: suggestedFix,
      canAutoHeal: true
    };
  }

  // 8. Permission Denied (chmod / EACCES)
  if (output.includes('Permission denied') || output.includes('EACCES')) {
    const cmdTokens = command.trim().split(' ');
    const firstToken = cmdTokens[0];
    const looksLikeScript = firstToken.startsWith('./') || firstToken.includes('/') || firstToken.endsWith('.sh') || firstToken.endsWith('.py') || firstToken.endsWith('.js');
    if (looksLikeScript) {
      return {
        category: 'permission',
        rootCause: `Execute permissions missing for file: ${firstToken}`,
        explanation: `The system refused to execute the script '${firstToken}' because it does not have the executable permission (+x) set.`,
        suggestedFix: `chmod +x ${firstToken}`,
        canAutoHeal: true
      };
    } else {
      return {
        category: 'permission',
        rootCause: 'Command execution failed due to insufficient permissions.',
        explanation: 'Your command encountered a Permission Denied error. You might need to adjust folder/file permissions or check if the target directory is writable.',
        suggestedFix: '',
        canAutoHeal: false
      };
    }
  }

  // 9. PowerShell Script Execution Policy
  if (output.includes('running scripts is disabled on this system') || 
      output.includes('about_Execution_Policies')) {
    return {
      category: 'permission',
      rootCause: 'PowerShell script execution is disabled on this system.',
      explanation: 'Your command failed because Windows PowerShell execution policy restricts running scripts. You need to enable running scripts for the current user.',
      suggestedFix: 'powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"',
      canAutoHeal: true
    };
  }

  return null;
}

// Helper to get default models
function getDefaultModel(provider) {
  if (provider === 'openai') return 'gpt-4o';
  if (provider === 'gemini') return 'gemini-2.5-flash';
  if (provider === 'claude') return 'claude-3-5-sonnet-latest';
  if (provider === 'openrouter') return 'openrouter/free';
  if (provider === 'ollama') return 'llama3';
  return '';
}

// Helper to extract JSON from raw text outputs
function extractJSON(text) {
  if (!text) return null;
  
  // 1. Try to find markdown json blocks first
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (mdMatch) {
    try {
      return JSON.parse(mdMatch[1]);
    } catch (e) {}
  }
  
  // 2. Try parsing the whole text
  try {
    return JSON.parse(text);
  } catch (e) {}
  
  // 3. Fallback: find the first { or [ and the last } or ]
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  const endObj = text.lastIndexOf('}');
  const endArr = text.lastIndexOf(']');
  
  let start = -1;
  let end = -1;
  
  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
    start = startObj;
    end = endObj;
  } else if (startArr !== -1) {
    start = startArr;
    end = endArr;
  }
  
  if (start !== -1 && end !== -1 && end > start) {
    const jsonStr = text.substring(start, end + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (e) {}
  }
  
  // 4. Return gracefully on failure instead of throwing
  return null;
}

// Call Gemini API via HTTPS (dependency-free)
function runGeminiRequest(systemPrompt, model, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{
        parts: [{ text: systemPrompt }]
      }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Gemini API returned status code ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsedRes = JSON.parse(data);
          if (!parsedRes.candidates || parsedRes.candidates.length === 0) {
            if (parsedRes.promptFeedback) {
              reject(new Error(`Gemini API request was blocked: ${JSON.stringify(parsedRes.promptFeedback)}`));
            } else {
              reject(new Error(`Gemini API returned no candidates. Response: ${data}`));
            }
            return;
          }
          const candidate = parsedRes.candidates[0];
          if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            reject(new Error(`Gemini API returned an empty candidate structure. Response: ${data}`));
            return;
          }
          const responseText = candidate.content.parts[0].text;
          const result = extractJSON(responseText.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse Gemini JSON response: ${e.message}. Content was: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Gemini API request timed out after 30 seconds'));
    });

    req.write(postData);
    req.end();
  });
}

// Call Claude API via HTTPS (dependency-free)
function runClaudeRequest(systemPrompt, model, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      max_tokens: 1024,
      system: "You are the diagnostic engine for an Autonomous Self-Healing CLI Manager. Respond ONLY with a valid raw JSON object. Do not wrap in markdown or backticks.",
      messages: [{
        role: 'user',
        content: systemPrompt
      }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Claude API returned status code ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsedRes = JSON.parse(data);
          if (!parsedRes.content || parsedRes.content.length === 0) {
            reject(new Error(`Claude API returned no content. Response: ${data}`));
            return;
          }
          const responseText = parsedRes.content[0].text;
          const result = extractJSON(responseText.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse Claude JSON response: ${e.message}. Content was: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Claude API request timed out after 30 seconds'));
    });

    req.write(postData);
    req.end();
  });
}

// Call OpenRouter API via HTTPS (dependency-free)
function runOpenRouterRequest(systemPrompt, model, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: "You are the diagnostic engine for an Autonomous Self-Healing CLI Manager. Respond ONLY with a valid raw JSON object."
        },
        {
          role: 'user',
          content: systemPrompt
        }
      ],
      response_format: { type: 'json_object' }
    });

    const options = {
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenRouter API returned status code ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsedRes = JSON.parse(data);
          if (parsedRes.error) {
            reject(new Error(`OpenRouter API Error: ${parsedRes.error.message || JSON.stringify(parsedRes.error)}`));
            return;
          }
          if (!parsedRes.choices || parsedRes.choices.length === 0) {
            reject(new Error(`OpenRouter API returned no choices. Response: ${data}`));
            return;
          }
          const responseText = parsedRes.choices[0].message.content;
          const result = extractJSON(responseText.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse OpenRouter JSON response: ${e.message}. Content was: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('OpenRouter API request timed out after 30 seconds'));
    });

    req.write(postData);
    req.end();
  });
}

// Call OpenAI API via HTTPS (dependency-free)
function runOpenAIRequest(systemPrompt, model, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: "You are the diagnostic engine for an Autonomous Self-Healing CLI Manager. Respond ONLY with a valid raw JSON object."
        },
        {
          role: 'user',
          content: systemPrompt
        }
      ],
      response_format: { type: 'json_object' }
    });

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenAI API returned status code ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsedRes = JSON.parse(data);
          if (parsedRes.error) {
            reject(new Error(`OpenAI API Error: ${parsedRes.error.message || JSON.stringify(parsedRes.error)}`));
            return;
          }
          if (!parsedRes.choices || parsedRes.choices.length === 0) {
            reject(new Error(`OpenAI API returned no choices. Response: ${data}`));
            return;
          }
          const responseText = parsedRes.choices[0].message.content;
          const result = extractJSON(responseText.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI JSON response: ${e.message}. Content was: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('OpenAI API request timed out after 30 seconds'));
    });

    req.write(postData);
    req.end();
  });
}

// Call Ollama API locally (dependency-free)
function runOllamaRequest(systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      prompt: systemPrompt,
      stream: false,
      format: 'json',
      system: "You are the diagnostic engine for an Autonomous Self-Healing CLI Manager. Respond ONLY with a valid raw JSON object."
    });

    const options = {
      hostname: 'localhost',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama returned status code ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsedRes = JSON.parse(data);
          if (!parsedRes.response) {
            reject(new Error(`Ollama returned no response. Data: ${data}`));
            return;
          }
          const result = extractJSON(parsedRes.response.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse Ollama JSON response: ${e.message}. Content was: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Ollama connection error (Is Ollama running?): ${e.message}`));
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Ollama request timed out after 60 seconds'));
    });

    req.write(postData);
    req.end();
  });
}

// Helper: Extract valid file paths from text and read their contents to provide context to the LLM
function extractLocalContext(output, pwd) {
  if (!output) return '';
  // Support both Unix/Windows paths and optional drive letters
  const regex = /(?:^|[\s'"(])([a-zA-Z]:[\\/][a-zA-Z0-9_.\-\\/]+\.(?:js|ts|py|sh|json|html|css|jsx|tsx)|[a-zA-Z0-9_.\-\\/]+\.(?:js|ts|py|sh|json|html|css|jsx|tsx))(?=[\s'":)]|$)/g;
  const filePaths = new Set();
  let match;
  while ((match = regex.exec(output)) !== null) {
    filePaths.add(match[1]);
  }

  const cwd = pwd || process.cwd();
  
  // Implicitly add package.json if it exists
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    filePaths.add('package.json');
  }

  let contextBlocks = [];
  
  for (const filePath of filePaths) {
    if (contextBlocks.length >= 4) break;
    try {
      const normalizedPath = filePath.replace(/\\/g, '/');
      let checkPath = normalizedPath;
      if (process.platform !== 'win32' && /^[a-z]:/i.test(normalizedPath)) {
        checkPath = normalizedPath.slice(2);
      }
      const absPath = path.isAbsolute(checkPath) ? checkPath : path.resolve(cwd, checkPath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        const fileContent = fs.readFileSync(absPath, 'utf8');
        const lines = fileContent.split('\n');
        const truncated = lines.length > 300 ? lines.slice(0, 300).join('\n') + '\n\n...[FILE TRUNCATED FOR LENGTH]...' : fileContent;
        contextBlocks.push(`### File: ${filePath}\n\`\`\`\n${truncated}\n\`\`\``);
      }
    } catch (e) {}
  }

  let gitContext = '';
  try {
    const gitStatus = execSync('git status -s', { cwd, stdio: 'pipe', timeout: 2000 }).toString().trim();
    if (gitStatus) {
      gitContext = `\n\nGit Status (Uncommitted Changes):\n\`\`\`\n${gitStatus}\n\`\`\``;
    }
  } catch (e) {}

  let envContext = '';
  try {
    const envPath = path.join(cwd, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const keys = [];
      const regexEnv = /^([a-zA-Z_][a-zA-Z0-9_]*)=/gm;
      let m;
      while ((m = regexEnv.exec(envContent)) !== null) {
        keys.push(m[1]);
      }
      if (keys.length > 0) {
        envContext = `\n\nEnvironment Variables Configured (Keys Only):\n- ${keys.join('\n- ')}`;
      }
    }
  } catch (e) {}

  let finalContext = '';
  if (contextBlocks.length > 0) {
    finalContext += `\n\nLocal File Context:\nThe following files were referenced in the error or are project configs. Use this actual code to accurately generate \`fileEdits\` without hallucinating line contents.\n\n` + contextBlocks.join('\n\n');
  }
  finalContext += gitContext;
  finalContext += envContext;
  return finalContext;
}

// Unified LLM Diagnostics Router
function runLLMDiagnostics(command, exitCode, output, config, pwd, previousAttempts = []) {
  const provider = config.provider || 'gemini';
  const model = config.model || getDefaultModel(provider);
  const apiKey = config[`${provider}_api_key`] || (provider === 'gemini' ? config.gemini_api_key : undefined);

  if (!apiKey && provider !== 'ollama') {
    throw new Error(`No API key configured for provider '${provider}'. Run 'heal config' to configure.`);
  }

  const truncatedOutput = truncateLogs(output, 100);
  const localContext = extractLocalContext(output + ' ' + command, pwd);

  let attemptsContext = '';
  if (previousAttempts && previousAttempts.length > 0) {
    attemptsContext = '\n\nPREVIOUS FAILED ATTEMPTS:\n' + previousAttempts.map((att, i) => `Attempt ${i + 1}:\n- Fix Applied: ${att.fix}\n- Resulting Error:\n"""\n${att.newErrorOutput}\n"""`).join('\n\n') + '\n\nDo not suggest the exact same fix again. You must try a different approach based on the new error.';
  }

  let customRulesContext = '';
  if (config.rules) {
    customRulesContext = `\n\nUSER CUSTOM RULES:\n${config.rules}`;
  }

  const systemPrompt = `You are the diagnostic engine for an Autonomous Self-Healing CLI Manager.
Analyze the following terminal command failure:
- Command: "${command}"
- Exit Code: ${exitCode}
- Terminal Output (stdout/stderr):
"""
${truncatedOutput}
"""${localContext}${attemptsContext}${customRulesContext}

Provide a diagnostic explanation and either a resolving shell command OR source code file edits if the error is a bug in the code.
If the error is a typo in a command, correct it.
If the error is a coding bug (e.g. ReferenceError, SyntaxError, type mismatch, etc.), specify the files that need to be edited to fix the issue in the 'fileEdits' array.
If the error cannot be solved by an action-oriented shell command or file edits (e.g. server outages), set canAutoHeal to false and suggestedFix to "".
Do not suggest destructive commands (like 'rm -rf /' or 'db:drop').

IMPORTANT TO PREVENT HALLUCINATIONS:
1. Do NOT invent non-existent CLI flags, commands, or NPM/Python packages.
2. If you are not 100% sure the command or package exists, set canAutoHeal to false and provide a generic helpful message instead.
3. For file edits, the targetContent MUST exactly and perfectly match the existing file context provided above, character-for-character, including indentation and spacing. Do not hallucinate lines that don't exist.

You MUST respond with a valid raw JSON object matching this schema, without markdown blocks, without backticks, just raw JSON:
{
  "errorCategory": "missing_dependency" | "typo" | "permission" | "port_conflict" | "syntax" | "environment" | "unknown",
  "rootCause": "Short sentence explaining the root cause of the error",
  "explanation": "Friendly description of what went wrong and how the suggested fix will resolve it.",
  "suggestedFix": "Single exact CLI command to fix the issue (e.g. 'npm install lodash'). Must be safe and non-destructive. Empty if there are fileEdits or it is not healable via shell command.",
  "canAutoHeal": true | false,
  "fileEdits": [
    {
      "filePath": "Relative path or absolute path to the file to edit",
      "targetContent": "Exact contiguous lines of code currently in the file that must be replaced. Make sure to include correct spacing/indentation. Do not hallucinate.",
      "replacementContent": "Complete replacement code for targetContent. Must resolve the error."
    }
  ]
}`;

  if (provider === 'gemini') {
    return runGeminiRequest(systemPrompt, model, apiKey);
  } else if (provider === 'openai') {
    return runOpenAIRequest(systemPrompt, model, apiKey);
  } else if (provider === 'claude') {
    return runClaudeRequest(systemPrompt, model, apiKey);
  } else if (provider === 'openrouter') {
    return runOpenRouterRequest(systemPrompt, model, apiKey);
  } else if (provider === 'ollama') {
    return runOllamaRequest(systemPrompt, model);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }
}

// Verification query helper for new API keys
function verifyAPIKey(provider, key) {
  const systemPrompt = `Test request. Respond ONLY with this exact JSON: { "status": "ok" }`;
  
  if (provider === 'gemini') {
    return runGeminiRequest(systemPrompt, 'gemini-2.5-flash', key);
  } else if (provider === 'openai') {
    return runOpenAIRequest(systemPrompt, 'gpt-4o-mini', key);
  } else if (provider === 'claude') {
    return runClaudeRequest(systemPrompt, 'claude-3-5-haiku-latest', key);
  } else if (provider === 'openrouter') {
    return runOpenRouterRequest(systemPrompt, 'openrouter/free', key);
  } else if (provider === 'ollama') {
    return runOllamaRequest(systemPrompt, 'llama3');
  }
}

// Helper: Show a Git-like unified diff of proposed code edits
function showFileDiff(filePath, targetContent, replacementContent) {
  if (!filePath) return;
  const fileBasename = path.basename(filePath);
  console.log(`\n${BOLD}Patching file:${RESET} ${CYAN}${fileBasename}${RESET} ${DIM}(${filePath})${RESET}`);
  console.log(`${GRAY}------------------------------------------------------------${RESET}`);
  
  const targetLines = (targetContent || '').split('\n');
  const replacementLines = (replacementContent || '').split('\n');
  
  for (const line of targetLines) {
    console.log(`${RED}-${RESET} ${RED}${line}${RESET}`);
  }
  for (const line of replacementLines) {
    console.log(`${GREEN}+${RESET} ${GREEN}${line}${RESET}`);
  }
  console.log(`${GRAY}------------------------------------------------------------${RESET}`);
}

// Helper: Safely resolve relative paths and expand tildes (~)
function resolvePath(pwd, filePath) {
  if (!filePath) return '';
  let cleanPath = filePath;
  if (cleanPath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    cleanPath = path.join(home, cleanPath.slice(2));
  } else if (cleanPath === '~') {
    cleanPath = process.env.HOME || process.env.USERPROFILE || '';
  }
  return path.isAbsolute(cleanPath) ? cleanPath : path.resolve(pwd || process.cwd(), cleanPath);
}

// Helper: Normalize line endings to LF
function normalizeLineEndings(str) {
  return str ? str.replace(/\r\n/g, '\n') : '';
}

// Helper: Ensure the file being edited is not a sensitive system file
function isFileEditSafe(filePath) {
  if (!filePath) return false;
  
  // Replace Windows backslashes with forward slashes first
  let cleanPath = filePath.replace(/\\/g, '/');
  
  // Check if it's absolute (starts with / or a drive letter like C:/)
  const isWinAbsolute = /^[a-z]:/i.test(cleanPath);
  const isUnixAbsolute = cleanPath.startsWith('/');
  
  let absPath;
  if (isWinAbsolute || isUnixAbsolute) {
    absPath = cleanPath;
  } else {
    // Relative path, resolve against cwd
    absPath = path.resolve(process.cwd(), filePath).replace(/\\/g, '/');
  }
  
  // Normalize traversal segments (e.g., /../)
  const parts = absPath.split('/');
  const stack = [];
  const hasDrive = /^[a-z]:/i.test(parts[0]);
  
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      }
    } else {
      stack.push(part);
    }
  }
  
  let resolvedPath = stack.join('/');
  if (absPath.startsWith('/')) {
    resolvedPath = '/' + resolvedPath;
  } else if (hasDrive) {
    resolvedPath = parts[0].toLowerCase() + '/' + resolvedPath.slice(parts[0].length).replace(/^\/+/, '');
  }
  
  const finalPath = resolvedPath.toLowerCase();

  // For Windows drive letters, strip "C:" prefix to check system directories
  let checkPath = finalPath;
  if (/^[a-z]:/i.test(finalPath)) {
    checkPath = finalPath.slice(2);
  }

  const unsafeSystemDirs = [
    '/etc/', '/var/', '/bin/', '/sbin/', '/usr/', '/system/',
    '/private/etc/', '/private/var/', '/private/bin/', '/private/sbin/', '/private/usr/',
    '/windows/', '/winnt/', '/program files/', '/program files (x86)/'
  ];
  const unsafeFilePatterns = [
    '.ssh/', '.bashrc', '.bash_profile', '.zshrc', '.profile'
  ];

  for (const dir of unsafeSystemDirs) {
    if (checkPath === dir || checkPath.startsWith(dir) || (dir.endsWith('/') && checkPath === dir.slice(0, -1))) {
      return false;
    }
  }
  for (const pattern of unsafeFilePatterns) {
    if (checkPath.includes(pattern)) {
      return false;
    }
  }
  return true;
}

// Execute command and capture full outputs
function runCommandWithLogging(command, pwd) {
  return new Promise((resolve) => {
    console.log(`\n${CYAN}🚀 Running command in diagnostic wrapper:${RESET} ${YELLOW}${command}${RESET}`);
    
    let cwdDir = pwd || process.cwd();
    if (!fs.existsSync(cwdDir)) {
      cwdDir = process.cwd();
    }

    // Spawn in shell context
    const child = spawn(command, [], {
      cwd: cwdDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'] // Pipe stdout/stderr, ignore stdin to prevent hijacking
    });

    let buffer = '';
    let killed = false;

    // Timeout after 15 seconds to prevent hanging on interactive commands or servers
    const timeout = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGTERM');
      } catch (e) {}
      buffer += `\n${RED}[Diagnostic Timeout: Command did not exit within 15 seconds and was terminated]${RESET}\n`;
    }, 15000);

    child.stdout.on('data', (data) => {
      const dataStr = data.toString();
      buffer += dataStr;
      process.stdout.write(dataStr);
    });

    child.stderr.on('data', (data) => {
      const dataStr = data.toString();
      buffer += dataStr;
      process.stderr.write(RED + dataStr + RESET);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ code: -1, output: buffer + `\nSpawn error: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code: killed ? -1 : code, output: buffer });
    });
  });
}

// Main self-healing controller
async function executeHealer(dryRun = false) {
  const cmdFile = LAST_FAILED_FILE + '.cmd';
  const codeFile = LAST_FAILED_FILE + '.code';
  const pwdFile = LAST_FAILED_FILE + '.pwd';

  if (!fs.existsSync(cmdFile)) {
    logError('No failed command logs found. Run a command that fails first!');
    return;
  }

  const failedCmd = fs.readFileSync(cmdFile, 'utf8').trim();
  const failedCode = parseInt(fs.existsSync(codeFile) ? fs.readFileSync(codeFile, 'utf8').trim() : '1');
  const failedPwd = fs.existsSync(pwdFile) ? fs.readFileSync(pwdFile, 'utf8').trim() : process.cwd();

  // Check if the command is ignored via .healignore configuration
  if (shouldIgnoreCommand(failedCmd, failedPwd)) {
    console.log(`${YELLOW}Command execution is ignored due to .healignore configuration.${RESET}\n`);
    cleanupFailedLogs();
    return;
  }

  // Guard against shell builtins that cannot be re-run in a child process
  const firstWord = failedCmd.trim().split(/\s+/)[0];
  const shellBuiltins = ['cd', 'fg', 'bg', 'jobs', 'export', 'set', 'unset', 'alias', 'unalias', 'source', '.', 'bindkey', 'history', 'fc'];
  if (shellBuiltins.includes(firstWord)) {
    logHeader('AUTONOMOUS SELF-HEALING ENGINE');
    console.log(`${GRAY}Intercepted:${RESET} ${YELLOW}${failedCmd}${RESET} ${DARK_GRAY}(code ${failedCode})${RESET}`);
    console.log(`${GRAY}Directory:  ${RESET}${DIM}${failedPwd}${RESET}\n`);
    logError(`The '${firstWord}' command is a shell builtin or interacts with the active terminal's state.`);
    console.log(`  The self-healing tool runs in a child process and cannot reliably diagnose or fix interactive shell state (like background jobs, aliases, or directory changes).\n`);
    cleanupFailedLogs();
    return;
  }

  logHeader('AUTONOMOUS SELF-HEALING ENGINE');
  console.log(`${GRAY}Intercepted:${RESET} ${YELLOW}${failedCmd}${RESET} ${DARK_GRAY}(code ${failedCode})${RESET}`);
  console.log(`${GRAY}Directory:  ${RESET}${DIM}${failedPwd}${RESET}\n`);

  // Confirm running the diagnostic
  const config = readConfig();
  const isAuto = config.autonomous === true;

  if (!isAuto) {
    const confirm = await askQuestion(`Run diagnostics to capture full terminal output logs? ${DIM}(Y/n)${RESET}: `);
    if (confirm.toLowerCase() === 'n') {
      console.log(`${YELLOW}Aborted diagnostics.${RESET}`);
      return;
    }
  }

  let currentExitCode = failedCode;
  let currentOutput = '';
  let retryCount = 0;
  const MAX_RETRIES = 3;

  // Run the failing command in our wrapper to capture the output logs
  let result = await runCommandWithLogging(failedCmd, failedPwd);

  if (result.code === 0) {
    logSuccess('Command completed successfully this time! No diagnostics or healing required.');
    // Clear files
    cleanupFailedLogs();
    return;
  }

  currentExitCode = result.code;
  currentOutput = result.output;
  let previousAttempts = [];

  while (retryCount < MAX_RETRIES) {
    // Check local diagnostics first
    console.log(`\n${CYAN}🔍 Analyzing error logs...${RESET}`);
    let diagnosis = runLocalDiagnostics(failedCmd, currentExitCode, currentOutput);

    // If local heuristics don't match, query LLM
    if (!diagnosis) {
      const config = readConfig();
      const provider = config.provider || 'gemini';
      const apiKey = config[`${provider}_api_key`] || (provider === 'gemini' ? config.gemini_api_key : undefined);

      if (apiKey || provider === 'ollama') {
        const activeModel = config.model || getDefaultModel(provider);
        const spinner = startSpinner(`Querying ${provider.toUpperCase()} (${activeModel}) for diagnosis...`);
        try {
          diagnosis = await runLLMDiagnostics(failedCmd, currentExitCode, currentOutput, config, failedPwd, previousAttempts);
          spinner.stop(true, `Diagnostics generated via ${provider.toUpperCase()}`);
        } catch (err) {
          spinner.stop(false, `Failed to query ${provider.toUpperCase()}`);
          logError(`${provider.toUpperCase()} API Error: ${err.message}`);
        }
      } else {
        console.log(`${YELLOW}ℹ Local heuristics missed. No API key set for provider '${provider}' for deep analysis.${RESET}`);
        console.log(`  Run ${BOLD}heal config${RESET} to configure your API key and model.\n`);
        return;
      }
    }

    const hasEdits = diagnosis && Array.isArray(diagnosis.fileEdits) && diagnosis.fileEdits.length > 0;

    if (!diagnosis || (!diagnosis.suggestedFix && !hasEdits)) {
      logError('Diagnostic complete: Could not formulate a reliable healing action.');
      if (diagnosis) {
        const wrappedRootCause = wrapText(diagnosis.rootCause || '', 60);
        const wrappedExplanation = wrapText(diagnosis.explanation || '', 60);
        const content = [
          `${CYAN}${BOLD}Category:${RESET} ${WHITE}${diagnosis.errorCategory || diagnosis.category || 'unknown'}${RESET}`,
          `${CYAN}${BOLD}Root Cause:${RESET}`,
          ...wrappedRootCause.map(line => `  ${WHITE}${line}${RESET}`),
          ``,
          `${CYAN}${BOLD}Explanation:${RESET}`,
          ...wrappedExplanation.map(line => `  ${GRAY}${line}${RESET}`)
        ];
        drawBox('DIAGNOSIS DETAIL', content, RED);
      }
      return;
    }

    // Display findings
    if (hasEdits) {
      const wrappedRootCause = wrapText(diagnosis.rootCause || '', 60);
      const wrappedExplanation = wrapText(diagnosis.explanation || '', 60);
      const content = [
        `${CYAN}${BOLD}Category:${RESET} ${WHITE}${diagnosis.errorCategory || diagnosis.category || 'unknown'}${RESET}`,
        `${CYAN}${BOLD}Root Cause:${RESET}`,
        ...wrappedRootCause.map(line => `  ${WHITE}${line}${RESET}`),
        ``,
        `${CYAN}${BOLD}Explanation:${RESET}`,
        ...wrappedExplanation.map(line => `  ${GRAY}${line}${RESET}`),
        ``,
        `${GREEN}${BOLD}Proposed Fix:${RESET} Patching ${YELLOW}${diagnosis.fileEdits.length}${RESET} file(s)`
      ];
      console.log();
      for (const edit of diagnosis.fileEdits) {
        if (!edit || !edit.filePath) continue;
        const absolutePath = resolvePath(failedPwd, edit.filePath);
        showFileDiff(absolutePath, edit.targetContent, edit.replacementContent);
      }
      console.log();
    } else {
      const wrappedRootCause = wrapText(diagnosis.rootCause || '', 60);
      const wrappedExplanation = wrapText(diagnosis.explanation || '', 60);
      const content = [
        `${CYAN}${BOLD}Category:${RESET} ${WHITE}${diagnosis.errorCategory || diagnosis.category || 'unknown'}${RESET}`,
        `${CYAN}${BOLD}Root Cause:${RESET}`,
        ...wrappedRootCause.map(line => `  ${WHITE}${line}${RESET}`),
        ``,
        `${CYAN}${BOLD}Explanation:${RESET}`,
        ...wrappedExplanation.map(line => `  ${GRAY}${line}${RESET}`),
        ``,
        `${GREEN}${BOLD}Suggested Fix:${RESET} ${YELLOW}${UNDERLINE}${diagnosis.suggestedFix}${RESET} ${DIM}(AI Generated - Verify before running)${RESET}`
      ];
      console.log();
      drawBox('DIAGNOSTIC REPORT', content, MAGENTA);
      console.log();
  
      // Safety blocklist check
      if (!isCommandSafe(diagnosis.suggestedFix, failedPwd)) {
        logError(`Security Guard: The suggested fix command is blacklisted as unsafe!\nBlocked Command: ${RED}${diagnosis.suggestedFix}`);
        return;
      }
    }

    // Ask to apply
    let apply = false;
    let selectedEdits = null;
    const isMultiEdit = hasEdits && diagnosis.fileEdits.length > 1;
    const promptText = isMultiEdit 
      ? `Apply these code patches? ${DIM}(Y)es / (n)o / (s)elect / (o)pen in IDE${RESET}: ` 
      : (hasEdits 
          ? `Apply these code patches? ${DIM}(Y)es / (n)o / (o)pen in IDE${RESET}: ` 
          : `Apply this fix? ${DIM}(Y/n)${RESET}: `);

    if (dryRun) {
      console.log(`\n${YELLOW}ℹ Dry-Run / Explain Mode: Skipping auto-apply.${RESET}`);
      return;
    }

    if (isAuto && diagnosis.canAutoHeal) {
      const proceed = await startAutonomyCountdown();
      if (proceed) {
        console.log(`\n${GREEN}🤖 Autonomous Mode: Applying fix...${RESET}`);
        apply = true;
        if (hasEdits) selectedEdits = diagnosis.fileEdits;
      } else {
        console.log(`\n${YELLOW}🤖 Autonomous Mode aborted by user.${RESET}`);
        const answer = (await askQuestion(promptText)).toLowerCase();
        if (answer === 'o' && hasEdits) {
          const firstEditPath = resolvePath(failedPwd, diagnosis.fileEdits[0].filePath);
          console.log(`\n${CYAN}💻 Opening ${firstEditPath} in VS Code...${RESET}`);
          try {
            execSync(`code -g "${firstEditPath}"`, { stdio: 'ignore' });
          } catch (e) {
            logError(`Could not open VS Code. Is 'code' in your PATH?`);
          }
          return;
        } else if (answer === 's' && isMultiEdit) {
           apply = true;
           selectedEdits = [];
           for (const edit of diagnosis.fileEdits) {
             const ans = await askQuestion(`Apply patch to ${edit.filePath}? ${DIM}(Y/n)${RESET}: `);
             if (ans.toLowerCase() !== 'n') selectedEdits.push(edit);
           }
        } else {
           apply = (answer !== 'n');
           if (apply && hasEdits) selectedEdits = diagnosis.fileEdits;
        }
      }
    } else {
      const answer = (await askQuestion(promptText)).toLowerCase();
      if (answer === 'o' && hasEdits) {
        const firstEditPath = resolvePath(failedPwd, diagnosis.fileEdits[0].filePath);
        console.log(`\n${CYAN}💻 Opening ${firstEditPath} in VS Code...${RESET}`);
        try {
          execSync(`code -g "${firstEditPath}"`, { stdio: 'ignore' });
        } catch (e) {
          logError(`Could not open VS Code. Is 'code' in your PATH?`);
        }
        return;
      } else if (answer === 's' && isMultiEdit) {
         apply = true;
         selectedEdits = [];
         for (const edit of diagnosis.fileEdits) {
           const ans = await askQuestion(`Apply patch to ${edit.filePath}? ${DIM}(Y/n)${RESET}: `);
           if (ans.toLowerCase() !== 'n') selectedEdits.push(edit);
         }
      } else {
         apply = (answer !== 'n');
         if (apply && hasEdits) selectedEdits = diagnosis.fileEdits;
      }
    }

    if (apply) {
      try {
        if (hasEdits) {
          if (selectedEdits.length === 0) {
            console.log(`\n${YELLOW}No patches selected. Aborting...${RESET}`);
            return;
          }
          console.log(`\n${CYAN}🛠️  Patching source code files...${RESET}`);
          const operationId = Date.now().toString();
          for (const edit of selectedEdits) {
            if (!edit || !edit.filePath) continue;
            const absolutePath = resolvePath(failedPwd, edit.filePath);
            if (!isFileEditSafe(absolutePath)) {
              throw new Error(`Security Guard: Patching file is blocked as it is in a sensitive location: ${absolutePath}`);
            }
            if (!fs.existsSync(absolutePath)) {
              throw new Error(`Target file to edit not found: ${absolutePath}`);
            }
            
            let fileContent = fs.readFileSync(absolutePath, 'utf8');
            const isCrlf = fileContent.includes('\r\n');
            const normalizedFile = normalizeLineEndings(fileContent);
            const normalizedTarget = normalizeLineEndings(edit.targetContent);
            const normalizedReplacement = normalizeLineEndings(edit.replacementContent);

            if (!normalizedFile.includes(normalizedTarget)) {
              throw new Error(`Could not locate the exact code block to replace in file: ${absolutePath}`);
            }

            const target = isCrlf ? normalizedTarget.replace(/\n/g, '\r\n') : normalizedTarget;
            const replacement = isCrlf ? normalizedReplacement.replace(/\n/g, '\r\n') : normalizedReplacement;

            if (fileContent.includes(target)) {
              fileContent = fileContent.replace(target, replacement);
            } else {
              fileContent = normalizedFile.replace(normalizedTarget, normalizedReplacement);
              if (isCrlf) {
                fileContent = fileContent.replace(/\n/g, '\r\n');
              }
            }

            // Create Backup
            if (!fs.existsSync(BACKUP_DIR)) {
              fs.mkdirSync(BACKUP_DIR, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFileName = `${timestamp}-${path.basename(absolutePath)}.bak`;
            const backupPath = path.join(BACKUP_DIR, backupFileName);
            fs.copyFileSync(absolutePath, backupPath);
            fs.writeFileSync(backupPath + '.meta.json', JSON.stringify({ operationId, originalPath: absolutePath, timestamp: new Date().toISOString() }), 'utf8');

            fs.writeFileSync(absolutePath, fileContent, 'utf8');
            logSuccess(`Successfully patched ${path.basename(absolutePath)}!`);
          }
        } else {
          console.log(`\n${CYAN}🛠️  Applying fix...${RESET}`);
          execSync(diagnosis.suggestedFix, { cwd: failedPwd, stdio: 'inherit' });
          logSuccess('Fix applied successfully!');
        }

        appendToHistory({
          command: failedCmd,
          category: diagnosis.errorCategory || diagnosis.category || 'unknown',
          fix: diagnosis.suggestedFix || null,
          fileEdits: hasEdits ? diagnosis.fileEdits.map(e => e.filePath).join(', ') : null
        });

        // Retry original command
        const isTypo = !hasEdits && (diagnosis.errorCategory || diagnosis.category) === 'typo';
        if (isTypo) {
          console.log(`\n${GREEN}${BOLD}🎉 SUCCESS! The corrected command was executed successfully!${RESET}\n`);
          cleanupFailedLogs();
          return;
        }
        
        console.log(`\n${CYAN}🔄 Retrying original command:${RESET} ${YELLOW}${failedCmd}${RESET}\n`);
        result = await runCommandWithLogging(failedCmd, failedPwd);
        
        if (result.code === 0) {
          console.log(`\n${GREEN}${BOLD}🎉 SUCCESS! The self-healing agent resolved the issue and the command finished successfully!${RESET}\n`);
          cleanupFailedLogs();
          return;
        } else {
          logError(`Command failed again on retry. Exit code: ${result.code}`);
          console.log(`\n${YELLOW}⚠️ Initiating iterative self-healing (Attempt ${retryCount + 1}/${MAX_RETRIES})...${RESET}`);
          
          previousAttempts.push({
            fix: diagnosis.suggestedFix || (hasEdits ? 'File Edits' : 'Unknown'),
            newErrorOutput: truncateLogs(result.output, 50)
          });

          currentExitCode = result.code;
          currentOutput = result.output;
          retryCount++;
        }
      } catch (e) {
        logError(`Error applying the suggested fix: ${e.message}`);
        return;
      }
    } else {
      console.log(`\n${YELLOW}Heal action skipped by user.${RESET}\n`);
      return;
    }
  }

  if (retryCount >= MAX_RETRIES) {
    logError(`Iterative self-healing failed after ${MAX_RETRIES} attempts. Please review the error logs manually.`);
  }
}

// Log cleanup
function cleanupFailedLogs() {
  const files = [LAST_FAILED_FILE + '.cmd', LAST_FAILED_FILE + '.code', LAST_FAILED_FILE + '.pwd'];
  files.forEach(f => {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  });
}

// Config CLI Actions
async function handleConfigCommand(args) {
  const config = readConfig(true);

  // If command-line arguments are provided, handle them directly
  if (args.length > 0) {
    if (args[0] === '--provider') {
      const provider = args[1];
      if (provider !== 'gemini' && provider !== 'claude' && provider !== 'openrouter' && provider !== 'ollama' && provider !== 'openai') {
        logError('Provider must be gemini, claude, openrouter, ollama, or openai.');
        return;
      }
      config.provider = provider;
      // Set to default model for this provider
      config.model = getDefaultModel(provider);
      writeConfig(config);
      logSuccess(`Active provider set to ${provider} (Default model: ${config.model})`);
    } else if (args[0] === '--key') {
      const key = args[1];
      if (!key) {
        logError('API key value missing. Usage: heal config --key MY_API_KEY');
        return;
      }
      const provider = config.provider || 'gemini';
      config[`${provider}_api_key`] = key;
      writeConfig(config);
      logSuccess(`API key for ${provider} saved successfully!`);
    } else if (args[0] === '--model') {
      const model = args[1];
      if (!model) {
        logError('Model value missing. Usage: heal config --model MODEL_NAME');
        return;
      }
      config.model = model;
      writeConfig(config);
      logSuccess(`Model set to ${model}!`);
    } else if (args[0] === '--auto') {
      const val = args[1];
      if (val !== 'true' && val !== 'false') {
        logError('Value must be true or false. Usage: heal config --auto true|false');
        return;
      }
      config.autonomous = (val === 'true');
      writeConfig(config);
      logSuccess(`Autonomous mode set to ${config.autonomous}!`);
    } else if (args[0] === '--rules') {
      const rules = args[1];
      if (rules === undefined) {
        logError('Rules value missing. Usage: heal config --rules "My rules..." (or use "clear" to remove rules)');
        return;
      }
      if (rules === 'clear' || rules === 'none' || rules === '') {
        delete config.rules;
        writeConfig(config);
        logSuccess('Custom rules cleared successfully!');
      } else {
        config.rules = rules;
        writeConfig(config);
        logSuccess(`Custom rules set successfully!`);
      }
    } else if (args[0] === '--proactive') {
      const val = args[1];
      if (val !== 'true' && val !== 'false') {
        logError('Value must be true or false. Usage: heal config --proactive true|false');
        return;
      }
      if (val === 'true') {
        fs.writeFileSync(PROACTIVE_FILE, '1', 'utf8');
        logSuccess('Proactive Daemon Mode ENABLED.');
      } else {
        if (fs.existsSync(PROACTIVE_FILE)) fs.unlinkSync(PROACTIVE_FILE);
        logSuccess('Proactive Daemon Mode DISABLED.');
      }
    } else {
      logError(`Unknown parameter '${args[0]}'.`);
    }
    return;
  }

  // Interactive CLI wizard
  logHeader('SELF-HEALING CONFIGURATION WIZARD');

  // 1. LLM Provider selection
  const providers = ['Gemini (Google)', 'Claude (Anthropic)', 'OpenRouter (Multi-model Gateway)', 'OpenAI (ChatGPT)'];
  const providerIndex = await selectOption(
    `Select LLM Provider:`,
    providers,
    config.provider === 'claude' ? 1 : (config.provider === 'openrouter' ? 2 : (config.provider === 'openai' ? 3 : 0))
  );
  const selectedProvider = ['gemini', 'claude', 'openrouter', 'openai'][providerIndex];

  // 2. Ask for API Key
  const currentKey = config[`${selectedProvider}_api_key`] || (selectedProvider === 'gemini' ? config.gemini_api_key : '');
  const keyPrompt = currentKey
    ? `Enter API Key (leave empty to keep current ${currentKey.slice(0, 6)}...): `
    : `Enter API Key: `;
  const apiKey = await askQuestion(keyPrompt);

  let activeKey = apiKey.trim() || currentKey;
  if (activeKey) {
    const spinner = startSpinner(`Testing connection to ${selectedProvider.toUpperCase()}...`);
    try {
      await verifyAPIKey(selectedProvider, activeKey);
      spinner.stop(true, `Connection to ${selectedProvider.toUpperCase()} verified successfully!`);
      console.log();
    } catch (err) {
      spinner.stop(false, `Connection test failed.`);
      console.log(`\n${RED}⚠️  API key validation failed: ${err.message}${RESET}`);
      const proceed = await askQuestion(`Would you like to save this key anyway? ${DIM}(y/N)${RESET}: `);
      if (proceed.toLowerCase() !== 'y') {
        console.log(`\n${YELLOW}Setup aborted. Settings not saved.${RESET}\n`);
        return;
      }
      console.log();
    }
  }

  // 3. Ask for Model Name
  const recommendedModels = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'Custom Model...'],
    claude: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest', 'Custom Model...'],
    openrouter: ['openrouter/free', 'google/gemini-2.5-flash', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.1-70b-instruct', 'Custom Model...'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'Custom Model...']
  };

  const modelOptions = recommendedModels[selectedProvider];
  // Determine default index
  let defaultModelIndex = 0;
  if (config.provider === selectedProvider && config.model) {
    const idx = modelOptions.indexOf(config.model);
    if (idx !== -1) defaultModelIndex = idx;
    else defaultModelIndex = modelOptions.length - 1; // Custom Model...
  }

  const modelIndex = await selectOption(
    `Select Model Name:`,
    modelOptions,
    defaultModelIndex
  );

  let finalModel = modelOptions[modelIndex];
  if (finalModel === 'Custom Model...') {
    const customPrompt = config.model ? `Enter Custom Model [default: ${config.model}]: ` : 'Enter Custom Model: ';
    const customModelInput = await askQuestion(`\n${customPrompt}`);
    finalModel = customModelInput.trim() || config.model || getDefaultModel(selectedProvider);
  }
  console.log();

  // 4. Ask for Autonomous Mode
  const autonomyOptions = ['ON (Execute fixes automatically)', 'OFF (Confirm before applying fixes)'];
  const autonomyIndex = await selectOption(
    `Enable Autonomous Mode:`,
    autonomyOptions,
    config.autonomous === true ? 0 : 1
  );
  const finalAutonomous = (autonomyIndex === 0);
  console.log();

  // 5. Ask for Proactive Daemon Mode
  const proactiveOptions = ['ON (Auto-run diagnostics when a terminal command fails)', 'OFF (Wait for manual "heal" execution)'];
  const proactiveIndex = await selectOption(
    `Enable Proactive Daemon Mode:`,
    proactiveOptions,
    fs.existsSync(PROACTIVE_FILE) ? 0 : 1
  );
  const finalProactive = (proactiveIndex === 0);
  console.log();

  // 6. Ask for Custom Rules
  const rulesOptions = ['Keep current / None', 'Set custom instructions', 'Clear custom instructions'];
  const rulesIndex = await selectOption(
    `Configure Custom System Prompt Instructions:`,
    rulesOptions,
    0
  );
  console.log();

  let finalRules = config.rules;
  if (rulesIndex === 1) {
    const rulesPrompt = config.rules ? `Enter Custom Instructions [default: ${config.rules}]: ` : 'Enter Custom Instructions: ';
    const customRulesInput = await askQuestion(rulesPrompt);
    if (customRulesInput.trim()) {
      finalRules = customRulesInput.trim();
    }
  } else if (rulesIndex === 2) {
    finalRules = undefined;
  }

  // Apply inputs
  config.provider = selectedProvider;
  if (apiKey.trim()) {
    config[`${selectedProvider}_api_key`] = apiKey.trim();
  } else if (!currentKey) {
    logInfo('No API key set for this provider.');
  }
  config.model = finalModel;
  config.autonomous = finalAutonomous;

  if (finalRules) {
    config.rules = finalRules;
  } else {
    delete config.rules;
  }

  if (finalProactive) {
    fs.writeFileSync(PROACTIVE_FILE, '1', 'utf8');
  } else {
    if (fs.existsSync(PROACTIVE_FILE)) {
      try { fs.unlinkSync(PROACTIVE_FILE); } catch (e) {}
    }
  }

  writeConfig(config);

  logSuccess('Configuration saved successfully!');
  console.log(`${DARK_GRAY}Settings file: ${CONFIG_PATH}${RESET}\n`);

  const summaryContent = [
    `${CYAN}${BOLD}Provider:       ${RESET}${WHITE}${config.provider.toUpperCase()}${RESET}`,
    `${CYAN}${BOLD}Model:          ${RESET}${WHITE}${config.model}${RESET}`,
    `${CYAN}${BOLD}API Key:        ${RESET}${config[`${config.provider}_api_key`] || (config.provider === 'gemini' && config.gemini_api_key) ? GREEN + '✓ Configured' : RED + '✗ Missing'}${RESET}`,
    `${CYAN}${BOLD}Autonomous:     ${RESET}${config.autonomous ? GREEN + 'ON' : YELLOW + 'OFF'}${RESET}`,
    `${CYAN}${BOLD}Proactive Mode: ${RESET}${finalProactive ? GREEN + 'ON' : YELLOW + 'OFF'}${RESET}`,
    `${CYAN}${BOLD}Custom Rules:   ${RESET}${config.rules ? GREEN + '✓ Configured' : GRAY + 'None'}${RESET}`
  ];
  if (config.rules) {
    summaryContent.push(...wrapText(config.rules, 55).map(line => `  ${GRAY}${line}${RESET}`));
  }
  drawBox('CURRENT CONFIGURATION', summaryContent, GREEN);
  console.log();
}

// Status Command
function handleStatusCommand() {
  const config = readConfig();
  const provider = config.provider || 'gemini';
  const model = config.model || getDefaultModel(provider);
  const apiKeyValid = !!(config[`${provider}_api_key`] || (provider === 'gemini' && config.gemini_api_key));
  const isProactive = fs.existsSync(PROACTIVE_FILE);

  console.log(`\n${DARK_GRAY}Global Settings file: ${CONFIG_PATH}${RESET}`);
  if (fs.existsSync(path.join(process.cwd(), '.healrc'))) {
    console.log(`${DARK_GRAY}Local Settings file:  ${path.join(process.cwd(), '.healrc')}${RESET}`);
  }
  console.log();

  const summaryContent = [
    `${CYAN}${BOLD}Provider:       ${RESET}${WHITE}${provider.toUpperCase()}${RESET}`,
    `${CYAN}${BOLD}Model:          ${RESET}${WHITE}${model}${RESET}`,
    `${CYAN}${BOLD}API Key:        ${RESET}${apiKeyValid ? GREEN + '✓ Configured' : (provider === 'ollama' ? GRAY + '- Not Required' : RED + '✗ Missing')}${RESET}`,
    `${CYAN}${BOLD}Autonomous:     ${RESET}${config.autonomous ? GREEN + 'ON' : YELLOW + 'OFF'}${RESET}`,
    `${CYAN}${BOLD}Proactive Mode: ${RESET}${isProactive ? GREEN + 'ON' : YELLOW + 'OFF'}${RESET}`,
    `${CYAN}${BOLD}Custom Rules:   ${RESET}${config.rules ? GREEN + '✓ Configured' : GRAY + 'None'}${RESET}`
  ];

  if (config.rules) {
    summaryContent.push(``);
    summaryContent.push(`${CYAN}${BOLD}Rules:${RESET}`);
    summaryContent.push(...wrapText(config.rules, 55).map(line => `  ${GRAY}${line}${RESET}`));
  }

  drawBox('CURRENT CONFIGURATION', summaryContent, GREEN);
  console.log();
}

// History Logging
function appendToHistory(entry) {
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {}
  }
  history.push({
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (history.length > 100) history = history.slice(history.length - 100);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

function handleLogsCommand() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(`${YELLOW}No history logs found.${RESET}`);
    return;
  }
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    logError('Could not read history file.');
    return;
  }
  console.log(`\n${BOLD}${MAGENTA}⚡ Self-Healing CLI History ⚡${RESET}\n`);
  history.reverse().slice(0, 10).forEach((entry, i) => {
    console.log(`${CYAN}[${entry.timestamp}]${RESET} - ${GRAY}Command:${RESET} ${entry.command}`);
    console.log(`  ${GRAY}Error Category:${RESET} ${entry.category}`);
    if (entry.fix) console.log(`  ${GRAY}Fix Applied:${RESET} ${entry.fix}`);
    if (entry.fileEdits) console.log(`  ${GRAY}Files Patched:${RESET} ${entry.fileEdits}`);
    console.log();
  });
}

function handleStatsCommand() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(`${YELLOW}No history logs found. Self-healing agent has not run yet.${RESET}`);
    return;
  }
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    logError('Could not read history file.');
    return;
  }

  if (history.length === 0) {
    console.log(`${YELLOW}History is empty.${RESET}`);
    return;
  }

  const total = history.length;
  let fileEditsCount = 0;
  let shellFixesCount = 0;
  const categories = {};

  history.forEach(entry => {
    if (entry.fileEdits) fileEditsCount++;
    if (entry.fix && !entry.fileEdits) shellFixesCount++;

    const cat = entry.category || 'unknown';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]);

  console.log(`\n${BOLD}${CYAN}📊 Self-Healing CLI Analytics 📊${RESET}\n`);
  console.log(`${WHITE}Total Successful Heals:${RESET} ${GREEN}${total}${RESET}`);
  console.log(`${WHITE}Shell Commands Fixed:${RESET}   ${GREEN}${shellFixesCount}${RESET}`);
  console.log(`${WHITE}Source Code Patches:${RESET}    ${GREEN}${fileEditsCount}${RESET}`);
  console.log(`\n${WHITE}Most Common Error Categories:${RESET}`);
  sortedCategories.forEach(([cat, count]) => {
    console.log(`  - ${YELLOW}${cat}${RESET}: ${count} times`);
  });
  console.log();
}

async function handleUndoCommand() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log(`${YELLOW}No backups found.${RESET}`);
    return;
  }
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.meta.json'));
  if (files.length === 0) {
    console.log(`${YELLOW}No backups found.${RESET}`);
    return;
  }
  
  // Parse all metas
  let allMetas = [];
  for (const f of files) {
    try {
      const p = path.join(BACKUP_DIR, f);
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      m.metaPath = p;
      m.backupFile = p.replace('.meta.json', '');
      allMetas.push(m);
    } catch (e) {}
  }
  
  if (allMetas.length === 0) {
    console.log(`${YELLOW}No valid backups found.${RESET}`);
    return;
  }

  // Group metas by operationId or timestamp
  const operationsMap = {};
  for (const m of allMetas) {
    const key = m.operationId || m.timestamp;
    if (!operationsMap[key]) {
      operationsMap[key] = {
        operationId: m.operationId,
        timestamp: m.timestamp,
        files: [],
        metas: []
      };
    }
    operationsMap[key].files.push(m.originalPath);
    operationsMap[key].metas.push(m);
  }

  // Sort operations by recency
  const sortedOperations = Object.values(operationsMap).sort((a, b) => {
    const timeA = a.operationId ? parseInt(a.operationId) : new Date(a.timestamp).getTime();
    const timeB = b.operationId ? parseInt(b.operationId) : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  // Construct options for selection
  const options = [];
  const lastOp = sortedOperations[0];
  const lastOpFilesList = lastOp.files.map(f => path.basename(f)).join(', ');
  options.push(`Undo last operation: Revert ${lastOpFilesList} (from ${lastOp.timestamp})`);
  
  if (sortedOperations.length > 1) {
    options.push('Select from history of previous operations...');
  }
  options.push('[ Cancel ]');

  const selection = await selectOption(`\n${BOLD}${MAGENTA}⚡ Undo Operation History ⚡${RESET}\nChoose an option:`, options);
  
  if (selection === -1 || selection === options.length - 1) {
    console.log(`${YELLOW}Undo cancelled.${RESET}\n`);
    return;
  }

  let selectedOp = lastOp;

  if (selection === 1 && sortedOperations.length > 1) {
    const historyOptions = sortedOperations.map(op => {
      const fls = op.files.map(f => path.basename(f)).join(', ');
      return `Revert ${fls} (from ${op.timestamp})`;
    });
    historyOptions.push('[ Back ]');

    const histSelection = await selectOption(`\nSelect which past operation to revert:`, historyOptions);
    if (histSelection === -1 || histSelection === historyOptions.length - 1) {
      console.log(`${YELLOW}Undo cancelled.${RESET}\n`);
      return;
    }
    selectedOp = sortedOperations[histSelection];
  }

  // Perform revert
  let restoredCount = 0;
  for (const meta of selectedOp.metas) {
    try {
      if (!fs.existsSync(meta.backupFile)) {
        logError(`Backup data file missing for ${meta.originalPath}`);
        continue;
      }
      // Recreate parent directories if they have been deleted
      fs.mkdirSync(path.dirname(meta.originalPath), { recursive: true });
      fs.copyFileSync(meta.backupFile, meta.originalPath);
      console.log(`${GREEN}✔ Restored ${meta.originalPath} to its previous state.${RESET}`);
      restoredCount++;
      try {
        fs.unlinkSync(meta.backupFile);
        if (meta.metaPath && fs.existsSync(meta.metaPath)) {
          fs.unlinkSync(meta.metaPath);
        }
      } catch (e) {}
    } catch (e) {
      logError(`Undo failed for ${meta.originalPath}: ${e.message}`);
    }
  }
  
  if (restoredCount > 0) {
    console.log(`\n${GREEN}${BOLD}✔ Successfully reverted files to previous state!${RESET}\n`);
  }
}

// Shell integration installer
function handleInstallCommand(overrideHomeDir) {
  const homeDir = overrideHomeDir || os.homedir() || process.env.HOME || process.env.USERPROFILE || '';
  const zshrcPath = path.join(homeDir, '.zshrc');
  const bashrcPath = path.join(homeDir, '.bashrc');
  const bashProfilePath = path.join(homeDir, '.bash_profile');
  const fishrcPath = path.join(homeDir, '.config', 'fish', 'config.fish');

  const zshHookPath = path.resolve(path.join(__dirname, '..', 'shell', 'self-healing.zsh'));
  const bashHookPath = path.resolve(path.join(__dirname, '..', 'shell', 'self-healing.bash'));
  const psHookPath = path.resolve(path.join(__dirname, '..', 'shell', 'self-healing.ps1'));
  const fishHookPath = path.resolve(path.join(__dirname, '..', 'shell', 'self-healing.fish'));

  const targets = [];
  if (fs.existsSync(zshrcPath)) {
    targets.push({
      path: zshrcPath,
      shell: 'zsh',
      hookScript: zshHookPath,
      format: 'sh'
    });
  }
  if (fs.existsSync(bashrcPath)) {
    targets.push({
      path: bashrcPath,
      shell: 'bash',
      hookScript: bashHookPath,
      format: 'sh'
    });
  }
  if (fs.existsSync(bashProfilePath)) {
    targets.push({
      path: bashProfilePath,
      shell: 'bash',
      hookScript: bashHookPath,
      format: 'sh'
    });
  }
  if (fs.existsSync(fishrcPath)) {
    targets.push({
      path: fishrcPath,
      shell: 'fish',
      hookScript: fishHookPath,
      format: 'fish'
    });
  } else {
    const fishDir = path.join(homeDir, '.config', 'fish');
    if (fs.existsSync(fishDir)) {
      targets.push({
        path: fishrcPath,
        shell: 'fish',
        hookScript: fishHookPath,
        format: 'fish'
      });
    }
  }

  // Add PowerShell profiles if their config directories exist
  const psProfiles = [
    path.join(homeDir, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(homeDir, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1')
  ];
  for (const profile of psProfiles) {
    const profileDir = path.dirname(profile);
    if (fs.existsSync(profileDir)) {
      targets.push({
        path: profile,
        shell: 'powershell',
        hookScript: psHookPath,
        format: 'ps'
      });
    }
  }

  if (targets.length === 0) {
    console.log(`${RED}Error: Could not locate any shell startup files or profile folders to install into.${RESET}`);
    return;
  }

  const startMarker = '# >>> self-healing-cli integration >>>';
  const endMarker = '# <<< self-healing-cli integration <<<';
  const integrationRegex = /# >>> self-healing-cli integration >>>[\s\S]*?# <<< self-healing-cli integration <<<\n?/g;
  let installedCount = 0;

  for (const target of targets) {
    const relativePath = target.path.replace(homeDir, '~');
    const isPS = target.format === 'ps';
    const isFish = target.format === 'fish';
    const installText = isPS
      ? `\n${startMarker}\nif (Test-Path "${target.hookScript.replace(/\\/g, '/')}") {\n    . "${target.hookScript.replace(/\\/g, '/')}"\n}\n${endMarker}\n`
      : (isFish
        ? `\n${startMarker}\nif test -f "${target.hookScript}"\n  source "${target.hookScript}"\nend\n${endMarker}\n`
        : `\n${startMarker}\nif [ -f "${target.hookScript}" ]; then\n  source "${target.hookScript}"\nfi\n${endMarker}\n`);

    try {
      // Create profile file if it doesn't exist
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      let content = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf8') : '';
      const hasBlock = content.includes('# Autonomous Self-Healing CLI Manager Integration') || content.includes(startMarker);

      if (hasBlock) {
        const normalizedHookScript = isPS ? target.hookScript.replace(/\\/g, '/') : target.hookScript;
        if (content.includes(normalizedHookScript) && content.includes(startMarker)) {
          console.log(`${YELLOW}Self-Healing CLI is already installed in ${relativePath} with the correct path!${RESET}`);
          continue;
        } else {
          const oldRegex = /# Autonomous Self-Healing CLI Manager Integration[\s\S]*?fi\n?/g;
          content = content.replace(integrationRegex, installText).replace(oldRegex, installText);
          fs.writeFileSync(target.path, content, 'utf8');
          console.log(`${GREEN}✔ Updated Self-Healing CLI hook path in ${relativePath}!${RESET}`);
          installedCount++;
          continue;
        }
      }

      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += installText;
      fs.writeFileSync(target.path, content, 'utf8');
      console.log(`${GREEN}✔ Successfully installed Shell integration in ${relativePath}!${RESET}`);
      installedCount++;
    } catch (e) {
      console.log(`${RED}Error writing to ${relativePath}: ${e.message}${RESET}`);
    }
  }

  if (installedCount > 0) {
    console.log(`\n${GREEN}${BOLD}✔ Successfully completed shell integration setup!${RESET}`);
    console.log(`${CYAN}Please restart your terminal or reload your shell profile to apply changes. Example:${RESET}`);
    console.log(`  ${BOLD}source ~/.zshrc${RESET} or ${BOLD}source ~/.config/fish/config.fish${RESET} or ${BOLD}reload your PowerShell profile${RESET}\n`);
  }
}

// Shell integration uninstaller
function handleUninstallCommand(overrideHomeDir) {
  const homeDir = overrideHomeDir || os.homedir() || process.env.HOME || process.env.USERPROFILE || '';
  const zshrcPath = path.join(homeDir, '.zshrc');
  const bashrcPath = path.join(homeDir, '.bashrc');
  const bashProfilePath = path.join(homeDir, '.bash_profile');
  const fishrcPath = path.join(homeDir, '.config', 'fish', 'config.fish');

  const targets = [];
  if (fs.existsSync(zshrcPath)) targets.push(zshrcPath);
  if (fs.existsSync(bashrcPath)) targets.push(bashrcPath);
  if (fs.existsSync(bashProfilePath)) targets.push(bashProfilePath);
  if (fs.existsSync(fishrcPath)) targets.push(fishrcPath);

  const psProfiles = [
    path.join(homeDir, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(homeDir, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1')
  ];
  for (const profile of psProfiles) {
    if (fs.existsSync(profile)) {
      targets.push(profile);
    }
  }

  if (targets.length === 0) {
    console.log(`${RED}Error: Could not locate any shell startup files to uninstall from.${RESET}`);
    return;
  }

  const startMarker = '# >>> self-healing-cli integration >>>';
  const endMarker = '# <<< self-healing-cli integration <<<';
  const integrationRegex = /# >>> self-healing-cli integration >>>[\s\S]*?# <<< self-healing-cli integration <<<\n?/g;
  const oldRegex = /# Autonomous Self-Healing CLI Manager Integration[\s\S]*?fi\n?/g;
  let uninstalledCount = 0;

  for (const filePath of targets) {
    const relativePath = filePath.replace(homeDir, '~');
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const hasOldBlock = content.includes('# Autonomous Self-Healing CLI Manager Integration');
      const hasNewBlock = content.includes(startMarker);
      if (hasOldBlock || hasNewBlock) {
        const cleanedContent = content.replace(integrationRegex, '').replace(oldRegex, '');
        fs.writeFileSync(filePath, cleanedContent, 'utf8');
        console.log(`${GREEN}✔ Successfully removed Self-Healing CLI integration from ${relativePath}!${RESET}`);
        uninstalledCount++;
      } else {
        console.log(`${YELLOW}Self-Healing CLI integration not found in ${relativePath}.${RESET}`);
      }
    } catch (e) {
      console.log(`${RED}Error cleaning up ${relativePath}: ${e.message}${RESET}`);
    }
  }

  if (uninstalledCount > 0) {
    console.log(`\n${GREEN}${BOLD}✔ Successfully completed shell integration uninstallation!${RESET}`);
    console.log(`${CYAN}Please restart your terminal or reload your shell profile to apply changes.${RESET}\n`);
  }
}

// Main Routing entry point
async function main() {
  let args = process.argv.slice(2);
  if (args[0] === 'heal') {
    args = args.slice(1);
  }
  const command = args[0];

  try {
    if (!command) {
      await executeHealer();
    } else if (command === 'config') {
      await handleConfigCommand(args.slice(1));
    } else if (command === 'install') {
      handleInstallCommand();
    } else if (command === 'uninstall') {
      handleUninstallCommand();
    } else if (command === 'undo') {
      await handleUndoCommand();
    } else if (command === 'logs') {
      handleLogsCommand();
    } else if (command === 'stats') {
      handleStatsCommand();
    } else if (command === 'status') {
      handleStatusCommand();
    } else if (command === 'explain') {
      await executeHealer(true);
    } else if (command === 'version' || command === '--version' || command === '-v') {
      try {
        const pkg = require('../package.json');
        console.log(`v${pkg.version}`);
      } catch (e) {
        console.log('v1.0.0');
      }
    } else {
      console.log(`\n${BOLD}Autonomous Self-Healing CLI Manager${RESET}`);
      console.log(`Usage:`);
      console.log(`  heal                            Diagnose and fix the last failed terminal command`);
      console.log(`  heal undo                       Revert the last file edits made by the AI`);
      console.log(`  heal status                     View current configuration status and rules`);
      console.log(`  heal logs                       View history of recently healed commands`);
      console.log(`  heal stats                      View analytics and success metrics`);
      console.log(`  heal explain                    Explain the last error without executing auto-healing`);
      console.log(`  heal install                    Install Zsh/Bash/Fish shell hooks into startup profiles`);
      console.log(`  heal uninstall                  Uninstall Zsh/Bash/Fish shell hooks from startup profiles`);
      console.log(`  heal config                     Launch interactive configuration wizard`);
      console.log(`  heal config --provider PROVIDER Set LLM provider (gemini, claude, openrouter, ollama)`);
      console.log(`  heal config --key KEY           Set API key for the current active provider`);
      console.log(`  heal config --model MODEL       Set model name for the current provider`);
      console.log(`  heal config --auto VAL          Set autonomous mode (true or false)`);
      console.log(`  heal config --proactive VAL     Set proactive daemon mode (true or false)`);
      console.log(`  heal config --rules RULES       Set custom system prompt instructions`);
      console.log(`  heal version                    Show CLI version number`);
      console.log();
    }
  } finally {
    closeReadline();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolvePath,
  normalizeLineEndings,
  isFileEditSafe,
  isCommandSafe,
  shouldIgnoreCommand,
  getPackageManager,
  runLocalDiagnostics,
  PYTHON_PIP_MAPPING,
  extractJSON,
  extractLocalContext,
  handleInstallCommand,
  handleUninstallCommand,
  readConfig
};
