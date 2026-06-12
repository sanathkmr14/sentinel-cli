const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
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
} = require('./cli/index.js');

let passCount = 0;
let failCount = 0;

function runTest(name, testFn) {
  try {
    testFn();
    console.log(`\x1b[32m✔ PASS\x1b[0m: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`\x1b[31m✘ FAIL\x1b[0m: ${name}`);
    console.error(err);
    failCount++;
  }
}

// --------------------------------------------------
// 1. Utility Tests
// --------------------------------------------------

runTest('resolvePath - expands tilde', () => {
  const home = os.homedir();
  assert.strictEqual(resolvePath('/some/pwd', '~/Developer'), path.join(home, 'Developer'));
  assert.strictEqual(resolvePath('/some/pwd', '~'), home);
});

runTest('resolvePath - handles empty and absolute paths', () => {
  assert.strictEqual(resolvePath('/some/pwd', ''), '');
  assert.strictEqual(resolvePath('/some/pwd', '/var/log'), '/var/log');
  assert.strictEqual(resolvePath('/some/pwd', 'relative/path'), path.resolve('/some/pwd', 'relative/path'));
});

runTest('normalizeLineEndings - normalizes CRLF to LF', () => {
  assert.strictEqual(normalizeLineEndings('line1\r\nline2\r\n'), 'line1\nline2\n');
  assert.strictEqual(normalizeLineEndings('line1\nline2\n'), 'line1\nline2\n');
  assert.strictEqual(normalizeLineEndings(''), '');
});

runTest('isFileEditSafe - security blocks system folders but permits tmp', () => {
  assert.strictEqual(isFileEditSafe('/etc/hosts'), false);
  assert.strictEqual(isFileEditSafe('/usr/local/bin'), false);
  assert.strictEqual(isFileEditSafe('/private/etc/sudoers'), false);
  assert.strictEqual(isFileEditSafe('/private/tmp/my_file.js'), true);
  assert.strictEqual(isFileEditSafe('/Users/harish/my_file.js'), true);
  
  // Bug: false positive for paths containing /bin/ but not being system /bin/
  assert.strictEqual(isFileEditSafe('/Users/harish/bin/test.js'), true);
});

runTest('isCommandSafe - blocks blacklisted commands', () => {
  assert.strictEqual(isCommandSafe('rm -rf /'), false);
  assert.strictEqual(isCommandSafe('rm -rf  /'), false); // Testing with extra space
  assert.strictEqual(isCommandSafe('sudo rm -rf /etc'), false);
  assert.strictEqual(isCommandSafe('shutdown now'), false);
  assert.strictEqual(isCommandSafe('git status'), true);
});

runTest('isCommandSafe - blocks destructive rm in root', () => {
  assert.strictEqual(isCommandSafe('rm -rf .', '/'), false);
  assert.strictEqual(isCommandSafe('rm -rf *', '/private'), false);
  assert.strictEqual(isCommandSafe('rm -rf ..', '/etc'), false);
  assert.strictEqual(isCommandSafe('rm -rf subfolder', '/'), true);
});

runTest('getPackageManager - detects correct lockfile', () => {
  const testDir = path.join(__dirname, '_test_lockfiles_temp_dir');
  fs.mkdirSync(testDir, { recursive: true });
  
  try {
    fs.writeFileSync(path.join(testDir, 'yarn.lock'), '# dummy');
    assert.strictEqual(getPackageManager(testDir), 'yarn');
    
    fs.unlinkSync(path.join(testDir, 'yarn.lock'));
    fs.writeFileSync(path.join(testDir, 'pnpm-lock.yaml'), '# dummy');
    assert.strictEqual(getPackageManager(testDir), 'pnpm');

    fs.unlinkSync(path.join(testDir, 'pnpm-lock.yaml'));
    fs.writeFileSync(path.join(testDir, 'package-lock.json'), '# dummy');
    assert.strictEqual(getPackageManager(testDir), 'npm');
  } finally {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  }
});

runTest('extractJSON - parses various JSON forms', () => {
  const rawText = 'Some markdown block:\n```json\n{"status": "ok"}\n```\nExtra text.';
  assert.deepStrictEqual(extractJSON(rawText), { status: "ok" });
  assert.deepStrictEqual(extractJSON('{"status": "direct"}'), { status: "direct" });
  
  // Fixed bug: should handle non-JSON gracefully by returning null instead of throwing
  assert.strictEqual(extractJSON('not a json'), null);
});

runTest('isFileEditSafe - blocks relative path traversal to system directories', () => {
  assert.strictEqual(isFileEditSafe('../../../../etc/passwd'), false);
  assert.strictEqual(isFileEditSafe('./bin/test.js'), true);
});

// --------------------------------------------------
// 2. Diagnostics Heuristics Tests
// --------------------------------------------------

runTest('runLocalDiagnostics - command typo', () => {
  const output = 'gitt: command not found';
  const diag = runLocalDiagnostics('gitt status', 127, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'typo');
  assert.strictEqual(diag.suggestedFix, 'git status');
  assert.strictEqual(diag.canAutoHeal, true);

  // Fixed bug: regex replaces safely across word boundaries without modifying substrings
  const diag2 = runLocalDiagnostics('gitt --version && gitt status', 127, 'gitt: command not found');
  assert.strictEqual(diag2.suggestedFix, 'git --version && git status');

  const diag3 = runLocalDiagnostics('npms run mynpms', 127, 'npms: command not found');
  assert.strictEqual(diag3.suggestedFix, 'npm run mynpms'); // Should not change mynpms
});

runTest('runLocalDiagnostics - port in use', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  try {
    const output = 'Error: listen EADDRINUSE: address already in use :::8080';
    const diag = runLocalDiagnostics('node server.js', 1, output);
    assert.ok(diag);
    assert.strictEqual(diag.category, 'port_conflict');
    assert.strictEqual(diag.suggestedFix, 'lsof -t -i:8080 | xargs kill -9');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

runTest('runLocalDiagnostics - port in use (win32)', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    const output = 'Error: listen EADDRINUSE: address already in use :::8080';
    const diag = runLocalDiagnostics('node server.js', 1, output);
    assert.ok(diag);
    assert.strictEqual(diag.category, 'port_conflict');
    assert.strictEqual(diag.suggestedFix, 'powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force"');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

runTest('runLocalDiagnostics - Python missing module mapping', () => {
  const output = "ModuleNotFoundError: No module named 'yaml'";
  const diag = runLocalDiagnostics('python3 main.py', 1, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'missing_dependency');
  assert.strictEqual(diag.suggestedFix, 'pip3 install pyyaml || pip install pyyaml');
});

runTest('runLocalDiagnostics - Git no upstream branch', () => {
  const output = 'fatal: The current branch my-feature has no upstream branch.';
  const diag = runLocalDiagnostics('git push', 128, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'git_conflict');
  assert.strictEqual(diag.suggestedFix, 'git push -u origin $(git branch --show-current)');
});

runTest('runLocalDiagnostics - Docker daemon offline', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  try {
    const output = 'docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?';
    const diag = runLocalDiagnostics('docker run ubuntu', 1, output);
    assert.ok(diag);
    assert.strictEqual(diag.category, 'environment');
    assert.strictEqual(diag.suggestedFix, 'open --background -a Docker');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

runTest('runLocalDiagnostics - Docker daemon offline (win32)', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    const output = 'docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?';
    const diag = runLocalDiagnostics('docker run ubuntu', 1, output);
    assert.ok(diag);
    assert.strictEqual(diag.category, 'environment');
    assert.strictEqual(diag.suggestedFix, 'powershell -Command "Start-Process \'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\'"');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

runTest('runLocalDiagnostics - Permission Denied for scripts', () => {
  const output = 'bash: ./deploy.sh: Permission denied';
  const diag = runLocalDiagnostics('./deploy.sh', 126, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'permission');
  assert.strictEqual(diag.suggestedFix, 'chmod +x ./deploy.sh');
  assert.strictEqual(diag.canAutoHeal, true);
});

runTest('runLocalDiagnostics - Network Offline detection', () => {
  const output = 'Error: getaddrinfo ENOTFOUND openrouter.ai';
  const diag = runLocalDiagnostics('curl https://openrouter.ai', 1, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'environment');
  assert.strictEqual(diag.rootCause, 'System is offline or DNS resolution failed.');
});

runTest('runLocalDiagnostics - Out of disk space', () => {
  const output = 'write error: No space left on device';
  const diag = runLocalDiagnostics('dd if=/dev/zero of=tempfile', 1, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'environment');
  assert.strictEqual(diag.rootCause, 'Disk space is full.');
  assert.ok(diag.suggestedFix.includes('df -h'));
});

runTest('runLocalDiagnostics - NPM global EACCES permissions', () => {
  const output = 'npm ERR! code EACCES\nnpm ERR! syscall symlink';
  const diag = runLocalDiagnostics('npm install -g lodash', 1, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'permission');
  assert.ok(diag.suggestedFix.includes('~/.npm-global'));
  assert.strictEqual(diag.canAutoHeal, true);
});
runTest('runLocalDiagnostics - Smart installation runtime suggestions', () => {
  const output = 'go: command not found';
  const diag = runLocalDiagnostics('go version', 127, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'typo');
  assert.ok(diag.suggestedFix.includes('go'));
});

runTest('runLocalDiagnostics - PowerShell script execution policy', () => {
  const output = 'File C:\\Users\\user\\script.ps1 cannot be loaded because running scripts is disabled on this system. For more information, see about_Execution_Policies';
  const diag = runLocalDiagnostics('powershell -File script.ps1', 1, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'permission');
  assert.strictEqual(diag.suggestedFix, 'powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"');
  assert.strictEqual(diag.canAutoHeal, true);
});

runTest('extractLocalContext - finds existing files in stack trace', () => {
  const output = `Error: Something went wrong
    at Object.<anonymous> (/Users/harish/Developer/Tool/test.js:2:15)
    at Module._compile (nonexistent.js:1:1)`;
  
  const ctx = extractLocalContext(output, process.cwd());
  assert.strictEqual(ctx.includes('Local File Context:'), true);
  assert.strictEqual(ctx.includes('### F' + 'ile: /Users/harish/Developer/Tool/test.js'), true);
  assert.strictEqual(ctx.includes('### F' + 'ile: nonexistent.js'), false);
});

runTest('shouldIgnoreCommand - respects ignore list with globs and comments', () => {
  const testDir = path.join(__dirname, '_test_ignore_temp_dir');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, '.healignore'), `
# ignore list comments
git status
npm run dev*
*webpack*
  `);

  try {
    assert.strictEqual(shouldIgnoreCommand('git status', testDir), true);
    assert.strictEqual(shouldIgnoreCommand('git status -s', testDir), true);
    assert.strictEqual(shouldIgnoreCommand('npm run dev --port 3000', testDir), true);
    assert.strictEqual(shouldIgnoreCommand('npx webpack build', testDir), true);
    assert.strictEqual(shouldIgnoreCommand('node index.js', testDir), false);
  } finally {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  }
});

runTest('isFileEditSafe - blocks system directories on Windows and macOS', () => {
  assert.strictEqual(isFileEditSafe('C:\\Windows\\System32\\cmd.exe'), false);
  assert.strictEqual(isFileEditSafe('C:\\Program Files\\app\\settings.json'), false);
  assert.strictEqual(isFileEditSafe('C:\\Users\\username\\app.js'), true);
  assert.strictEqual(isFileEditSafe('/etc/passwd'), false);
  assert.strictEqual(isFileEditSafe('/Users/harish/app.js'), true);
});

runTest('isCommandSafe - allows workspace absolute paths but blocks root deletions', () => {
  assert.strictEqual(isCommandSafe('rm -rf /Users/harish/myproject/node_modules'), true);
  assert.strictEqual(isCommandSafe('rm -rf /etc'), false);
  assert.strictEqual(isCommandSafe('rm -rf /'), false);
  assert.strictEqual(isCommandSafe('rm -rf ~'), false);
  assert.strictEqual(isCommandSafe('rm -rf /private/etc/hosts'), false);
});

runTest('extractLocalContext - supports Windows-style paths', () => {
  const tempFile = path.join(__dirname, '_temp_win_test.js');
  fs.writeFileSync(tempFile, '// dummy test file content');
  
  try {
    const resolvedWinPath = tempFile.replace(/\//g, '\\');
    const mockTrace = `Error: crash\n  at (${resolvedWinPath}:1:1)`;
    
    const ctx = extractLocalContext(mockTrace, __dirname);
    assert.strictEqual(ctx.includes('Local File Context:'), true);
    assert.strictEqual(ctx.includes('_temp_win_test.js'), true);
    assert.strictEqual(ctx.includes('// dummy test file content'), true);
  } finally {
    try { fs.unlinkSync(tempFile); } catch (e) {}
  }
});

runTest('handleInstallCommand & handleUninstallCommand - integrates with Fish shell', () => {
  const mockHome = path.join(__dirname, '_mock_home');
  const fishrcDir = path.join(mockHome, '.config', 'fish');
  const fishrcPath = path.join(fishrcDir, 'config.fish');
  
  // Set up mock directory
  fs.mkdirSync(fishrcDir, { recursive: true });
  fs.writeFileSync(fishrcPath, '# Existing fish configuration\n');

  try {
    // Run install
    handleInstallCommand(mockHome);
    const contentAfterInstall = fs.readFileSync(fishrcPath, 'utf8');
    assert.ok(contentAfterInstall.includes('# >>> self-healing-cli integration >>>'));
    assert.ok(contentAfterInstall.includes('self-healing.fish'));
    
    // Run uninstall
    handleUninstallCommand(mockHome);
    const contentAfterUninstall = fs.readFileSync(fishrcPath, 'utf8');
    assert.ok(!contentAfterUninstall.includes('# >>> self-healing-cli integration >>>'));
    assert.ok(!contentAfterUninstall.includes('self-healing.fish'));
  } finally {
    try { fs.rmSync(mockHome, { recursive: true, force: true }); } catch (e) {}
  }
});

runTest('runLocalDiagnostics - PowerShell cmdlet typo', () => {
  const output = "The term 'gitt' is not recognized as the name of a cmdlet, function, script file, or operable program.";
  const diag = runLocalDiagnostics('gitt status', 1, output);
  assert.ok(diag);
  assert.strictEqual(diag.category, 'typo');
  assert.strictEqual(diag.suggestedFix, 'git status');
  assert.strictEqual(diag.canAutoHeal, true);
});

runTest('readConfig - supports globalOnly parameter to isolate local config', () => {
  const localConfigPath = path.join(process.cwd(), '.healrc');
  const hasExistingLocal = fs.existsSync(localConfigPath);
  let oldLocalContent = '';
  if (hasExistingLocal) {
    oldLocalContent = fs.readFileSync(localConfigPath, 'utf8');
  }

  // Create temporary local config
  fs.writeFileSync(localConfigPath, JSON.stringify({ provider: 'temporary-mock-provider' }), 'utf8');

  try {
    const configMerged = readConfig(false);
    assert.strictEqual(configMerged.provider, 'temporary-mock-provider');

    const configGlobal = readConfig(true);
    assert.notStrictEqual(configGlobal.provider, 'temporary-mock-provider');
  } finally {
    if (hasExistingLocal) {
      fs.writeFileSync(localConfigPath, oldLocalContent, 'utf8');
    } else {
      try { fs.unlinkSync(localConfigPath); } catch (e) {}
    }
  }
});

runTest('isFileEditSafe - blocks exact matches to system folders without trailing slash', () => {
  assert.strictEqual(isFileEditSafe('/etc'), false);
  assert.strictEqual(isFileEditSafe('/usr'), false);
  assert.strictEqual(isFileEditSafe('/var'), false);
  assert.strictEqual(isFileEditSafe('/Users/harish/etc'), true);
  assert.strictEqual(isFileEditSafe('/Users/harish/etc/test.js'), true);
});

runTest('isCommandSafe - blocks destructive rm inside subfolders of system roots', () => {
  assert.strictEqual(isCommandSafe('rm -rf .', '/usr/local/bin'), false);
  assert.strictEqual(isCommandSafe('rm -rf *', '/etc/apt'), false);
  assert.strictEqual(isCommandSafe('rm -rf *', '/Users/harish/myproject'), true);
});

// --------------------------------------------------
// Summary Report
// --------------------------------------------------

console.log(`\n==================================================`);
console.log(`TEST RESULTS SUMMARY`);
console.log(`==================================================`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  console.log(`\n\x1b[31mStatus: FAIL\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\n\x1b[32mStatus: SUCCESS\x1b[0m`);
  process.exit(0);
}
