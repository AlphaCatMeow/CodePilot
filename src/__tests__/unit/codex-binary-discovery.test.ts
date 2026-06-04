/**
 * Phase 5b smoke round 6 (2026-05-18) — `findCodexBinary` discovery
 * order pins.
 *
 * User-driven scenario: the macOS Codex.app installer drops the
 * `codex` binary inside the app bundle (`/Applications/Codex.app/
 * Contents/Resources/codex`) but doesn't always wire a PATH entry,
 * so users who installed via the .dmg saw "未安装" on Settings →
 * 执行引擎 → Codex even though `command -v codex` would resolve
 * via shell shims. The fix adds the bundled path as a last-resort
 * fallback AFTER PATH walk + CODEX_BIN + CODEX_DISABLED still take
 * priority.
 *
 * Behavioural test: drive the real function via env mutation to
 * cover the CODEX_DISABLED + CODEX_BIN paths. The macOS bundle
 * fallback can't be unit-tested without mocking `existsSync`, so
 * it's covered via a source-grep pin (the wider `app-server-manager
 * .ts` continues to be smoke-verified against a real CLI install).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findCodexBinary,
  parseCodexVersion,
  selectBestCodexCandidate,
  isFatalCodexConfigStderr,
  resetCodexBinaryCacheForTests,
  buildCodexLaunch,
} from '@/lib/codex/app-server-manager';

const managerSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/app-server-manager.ts'),
  'utf8',
);

describe('findCodexBinary — discovery order (round 6)', () => {
  let savedDisabled: string | undefined;
  let savedBin: string | undefined;
  let savedPath: string | undefined;

  before(() => {
    savedDisabled = process.env.CODEX_DISABLED;
    savedBin = process.env.CODEX_BIN;
    savedPath = process.env.PATH;
  });

  after(() => {
    if (savedDisabled === undefined) delete process.env.CODEX_DISABLED;
    else process.env.CODEX_DISABLED = savedDisabled;
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  });

  it('CODEX_DISABLED=1 returns null even when CODEX_BIN points at a real file', () => {
    process.env.CODEX_DISABLED = '1';
    // Pick a path that definitely exists (this test file).
    process.env.CODEX_BIN = __filename;
    process.env.PATH = '';
    resetCodexBinaryCacheForTests();
    assert.equal(findCodexBinary(), null,
      'CODEX_DISABLED must beat CODEX_BIN — it is the test-harness escape hatch');
  });

  it('CODEX_BIN takes priority over PATH walk + macOS fallback', () => {
    delete process.env.CODEX_DISABLED;
    process.env.CODEX_BIN = __filename; // existing file
    process.env.PATH = '/no/such/dir';
    resetCodexBinaryCacheForTests();
    const out = findCodexBinary();
    assert.equal(out, __filename,
      'CODEX_BIN must return the explicit path when the file exists');
  });

  it('CODEX_BIN pointing at a non-existent file falls through to PATH walk', () => {
    delete process.env.CODEX_DISABLED;
    process.env.CODEX_BIN = '/definitely/does/not/exist/codex';
    process.env.PATH = '/no/such/dir';
    resetCodexBinaryCacheForTests();
    // No PATH match, no real CLI on the test machine for sure — but
    // on macOS we may find the Codex.app fallback. So we only assert
    // that the result isn't the broken CODEX_BIN path.
    const out = findCodexBinary();
    assert.notEqual(out, '/definitely/does/not/exist/codex',
      'CODEX_BIN with non-existent file must NOT be returned verbatim');
  });
});

describe('findCodexBinary — source pins (round 6 macOS bundle fallback)', () => {
  it('source declares the /Applications/Codex.app/Contents/Resources/codex fallback path', () => {
    // The exact path string. Refactoring is fine as long as the
    // literal stays present somewhere in the file — that's what
    // makes the .dmg-installed user no longer see "未安装".
    assert.match(
      managerSrc,
      /\/Applications\/Codex\.app\/Contents\/Resources\/codex/,
      'macOS Codex.app bundled-binary fallback path must remain in app-server-manager.ts',
    );
  });

  it('source gates the fallback on darwin (no Windows / Linux pickup of the macOS path)', () => {
    assert.match(
      managerSrc,
      /process\.platform\s*===\s*['"]darwin['"][\s\S]{0,400}Codex\.app/,
      'macOS fallback must be gated by process.platform === "darwin" so other platforms do not accidentally probe a macOS-specific path',
    );
  });

  it('source has the fallback AFTER the PATH walk (priority order)', () => {
    // Discovery priority: CODEX_DISABLED → CODEX_BIN → PATH → macOS
    // bundle. A future refactor that hoists the macOS path above
    // the PATH walk would silently mask a user's custom `codex`
    // build on their PATH, so we pin the order textually. Anchor on
    // the loop body of the PATH walk vs. the literal `/Applications
    // /Codex.app/...` string, since those are the load-bearing lines
    // that drive the runtime behaviour.
    const pathWalkIdx = managerSrc.search(/path\.split\(sep\)/);
    const macOsIdx = managerSrc.search(/\/Applications\/Codex\.app\/Contents\/Resources\/codex/);
    assert.notEqual(pathWalkIdx, -1, 'PATH walk anchor missing (looking for `path.split(sep)`)');
    assert.notEqual(macOsIdx, -1, 'macOS fallback path string missing');
    assert.ok(
      pathWalkIdx < macOsIdx,
      'PATH walk must come BEFORE the macOS Codex.app fallback so a custom `codex` on PATH still wins',
    );
  });
});

describe('Codex availability — installed but idle state', () => {
  it('returns installed_idle when a binary is found but app-server has not initialized', () => {
    // Phase 5b closeout follow-up (2026-05-19) — Settings →
    // Runtime showed "检测中…" forever because /api/codex/status is
    // intentionally non-spawning: when the binary exists but the
    // app-server has not been initialized, `lastAvailability` stayed
    // `unknown` forever. The UI needs a terminal non-spinner state for
    // this common idle case.
    assert.match(
      managerSrc,
      /lastAvailability\.kind\s*===\s*['"]unknown['"][\s\S]{0,120}installed_idle/,
      'getCodexAvailability must turn binary-found + unknown cache into installed_idle, not return unknown forever',
    );
  });

  it('RuntimePanel renders installed_idle as a non-spinner state', () => {
    const panelSrc = fs.readFileSync(
      path.resolve(__dirname, '../../components/settings/RuntimePanel.tsx'),
      'utf8',
    );
    assert.match(panelSrc, /codexAvailability\.kind\s*===\s*["']installed_idle["']/);
    // Copy softening (2026-05-19) — "待启动" was misread as "not yet
    // usable". The new wording frames it as available + a small
    // explainer about on-demand startup. Both languages tested so a
    // refactor can't drop one side accidentally.
    assert.match(panelSrc, /已安装，可用/);
    assert.match(panelSrc, /Installed, starts on demand/);
    assert.doesNotMatch(
      panelSrc,
      /installed_idle[\s\S]{0,220}SpinnerGap/,
      'installed_idle must not render the detecting spinner',
    );
  });
});

describe('Codex app-server spawn compatibility', () => {
  it('launches app-server via buildCodexLaunch (default stdio, never --listen)', () => {
    // Preview P0 (2026-05-31): a user-installed Codex binary returned
    // `unexpected argument '--listen' found`. Codex app-server's default
    // transport is stdio, so CodePilot must not require --listen.
    // Phase 1 (2026-06-02) routed the spawn through buildCodexLaunch so a
    // Windows `.cmd` shim gets a cmd.exe wrapper; we pin the app-server
    // subcommand + no---listen contract that older Codex.app builds need.
    assert.match(
      managerSrc,
      /buildCodexLaunch\(binary,\s*\[\s*['"]app-server['"]\s*\]/,
      'app-server must be launched through buildCodexLaunch with the app-server subcommand',
    );
    assert.match(
      managerSrc,
      /spawn\(launch\.command,\s*launch\.args/,
      'getCodexAppServer must spawn the launch spec (command + args), not the raw binary',
    );
    assert.doesNotMatch(
      managerSrc,
      /['"]--listen['"]/,
      'app-server spawn must not include --listen; older Codex.app builds reject it',
    );
  });
});

describe('buildCodexLaunch — Windows .cmd shim wrapping (Phase 1, 2026-06-02)', () => {
  // Packaged-Windows P0: the resolved codex was an npm `.cmd` shim and
  // `spawn(shim, [...])` failed with EINVAL because Windows can't execute a
  // batch file directly. buildCodexLaunch wraps shims in cmd.exe; .exe and
  // macOS/Linux paths stay a direct spawn.
  it('macOS/Linux path is a direct spawn, unchanged', () => {
    const launch = buildCodexLaunch('/usr/local/bin/codex', ['app-server'], 'darwin');
    assert.equal(launch.command, '/usr/local/bin/codex');
    assert.deepEqual(launch.args, ['app-server']);
    assert.ok(!launch.windowsVerbatimArguments, 'no verbatim-args wrapping off Windows');
  });

  it('Windows .exe is a direct spawn (no cmd.exe wrapper)', () => {
    const launch = buildCodexLaunch('C:\\Program Files\\Codex\\codex.exe', ['app-server'], 'win32');
    assert.equal(launch.command, 'C:\\Program Files\\Codex\\codex.exe');
    assert.deepEqual(launch.args, ['app-server']);
    assert.ok(!launch.windowsVerbatimArguments);
  });

  it('Windows .cmd shim is wrapped in cmd.exe /d /s /c, NOT spawned directly', () => {
    const cmd = 'C:\\Users\\tyler\\AppData\\Roaming\\npm\\codex.cmd';
    const launch = buildCodexLaunch(cmd, ['app-server'], 'win32', 'C:\\Windows\\System32\\cmd.exe');
    assert.equal(
      launch.command,
      'C:\\Windows\\System32\\cmd.exe',
      'a .cmd shim must launch through the command interpreter, not directly (that is the EINVAL bug)',
    );
    assert.notEqual(launch.command, cmd);
    assert.deepEqual(launch.args, ['/d', '/s', '/c', `""${cmd}" "app-server""`]);
    assert.equal(launch.windowsVerbatimArguments, true);
  });

  it('Windows .cmd path with spaces stays quoted so it survives cmd /s /c', () => {
    const cmd = 'C:\\Program Files\\npm\\codex.cmd';
    const launch = buildCodexLaunch(cmd, ['app-server'], 'win32', 'cmd.exe');
    assert.match(launch.args[3], /"C:\\Program Files\\npm\\codex\.cmd"/);
  });

  it('Windows .bat shim is also wrapped', () => {
    const launch = buildCodexLaunch('C:\\x\\codex.bat', ['--version'], 'win32', 'cmd.exe');
    assert.equal(launch.command, 'cmd.exe');
    assert.deepEqual(launch.args, ['/d', '/s', '/c', '""C:\\x\\codex.bat" "--version""']);
    assert.equal(launch.windowsVerbatimArguments, true);
  });

  it('the version probe uses the same shim wrapping (so .cmd version detection works)', () => {
    const launch = buildCodexLaunch('C:\\n\\codex.cmd', ['--version'], 'win32', 'cmd.exe');
    assert.equal(launch.command, 'cmd.exe');
    assert.ok(launch.args.includes('/c'));
    assert.match(launch.args[3], /codex\.cmd/);
    assert.match(launch.args[3], /--version/);
  });

  it('source: probeCodexVersion routes through buildCodexLaunch too', () => {
    assert.match(
      managerSrc,
      /probeCodexVersion[\s\S]{0,200}buildCodexLaunch\(binaryPath,\s*\[\s*['"]--version['"]\s*\]/,
      'probeCodexVersion must wrap .cmd shims the same way (else .cmd version detection fails on Windows)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// P0.1 (2026-06-01) — version-aware binary discovery. The packaged P0 was
// an old Homebrew /opt/homebrew/bin/codex 0.45.0 on PATH shadowing the
// newer /Applications/Codex.app build 0.135.0; the old one rejected the
// user's `xhigh` effort config fatally. Discovery must pick the newer one.
// ─────────────────────────────────────────────────────────────────────

describe('selectBestCodexCandidate — version-aware discovery (P0.1)', () => {
  it('picks the newer Codex.app build over an older Homebrew codex listed first on PATH', () => {
    const chosen = selectBestCodexCandidate([
      { path: '/opt/homebrew/bin/codex', version: 'codex-cli 0.45.0' },
      { path: '/Applications/Codex.app/Contents/Resources/codex', version: 'codex-cli 0.135.0-alpha.1' },
    ]);
    assert.equal(chosen, '/Applications/Codex.app/Contents/Resources/codex');
  });

  it('does NOT silently pick the old PATH binary even when listed first', () => {
    const chosen = selectBestCodexCandidate([
      { path: '/opt/homebrew/bin/codex', version: 'codex-cli 0.45.0' },
      { path: '/Applications/Codex.app/Contents/Resources/codex', version: 'codex-cli 0.135.0-alpha.1' },
    ]);
    assert.notEqual(chosen, '/opt/homebrew/bin/codex');
  });

  it('compares numerically (0.135 > 0.45), not lexically', () => {
    assert.equal(
      selectBestCodexCandidate([
        { path: '/a', version: '0.135.0' },
        { path: '/b', version: '0.45.0' },
      ]),
      '/a',
    );
  });

  it('a parseable version beats an unparseable one regardless of order', () => {
    assert.equal(
      selectBestCodexCandidate([
        { path: '/broken', version: null },
        { path: '/ok', version: 'codex-cli 0.45.0' },
      ]),
      '/ok',
    );
    assert.equal(
      selectBestCodexCandidate([
        { path: '/ok', version: 'codex-cli 0.45.0' },
        { path: '/broken', version: null },
      ]),
      '/ok',
    );
  });

  it('equal versions keep input order (PATH-first tiebreak preserves the custom-build intent)', () => {
    assert.equal(
      selectBestCodexCandidate([
        { path: '/usr/local/bin/codex', version: '0.135.0' },
        { path: '/Applications/Codex.app/Contents/Resources/codex', version: '0.135.0' },
      ]),
      '/usr/local/bin/codex',
    );
  });

  it('returns null for no candidates', () => {
    assert.equal(selectBestCodexCandidate([]), null);
  });
});

describe('parseCodexVersion', () => {
  it('parses `codex-cli 0.135.0-alpha.1` → [0,135,0]', () => {
    assert.deepEqual(parseCodexVersion('codex-cli 0.135.0-alpha.1'), [0, 135, 0]);
  });
  it('parses a bare `0.45.0`', () => {
    assert.deepEqual(parseCodexVersion('0.45.0'), [0, 45, 0]);
  });
  it('returns null for null / garbage', () => {
    assert.equal(parseCodexVersion(null), null);
    assert.equal(parseCodexVersion('no version here'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// P0.2 (2026-06-01) — fatal-stderr fast-fail. The old binary prints the
// fatal config error to stderr and then lingers ~30s before exiting, so
// proc.once('exit') alone is too slow. Detect the signature on stderr.
// ─────────────────────────────────────────────────────────────────────

describe('isFatalCodexConfigStderr — fatal-stderr detection (P0.2)', () => {
  it('matches the xhigh deserialize fatal the old binary prints', () => {
    assert.equal(
      isFatalCodexConfigStderr(
        'Failed to deserialize overridden config: unknown variant `xhigh`, expected one of `minimal`, `low`, `medium`, `high`',
      ),
      true,
    );
  });
  it('matches `error loading config`', () => {
    assert.equal(isFatalCodexConfigStderr('Error: error loading config: unknown variant `xhigh`'), true);
  });
  it('does NOT match ordinary RUST_LOG / tracing lines', () => {
    assert.equal(isFatalCodexConfigStderr('INFO app_server.request{otel.name="model/list"}: enter'), false);
    assert.equal(isFatalCodexConfigStderr('listening on stdio'), false);
  });

  it('does NOT SIGKILL on a bare `unknown variant` without config context (Codex P2 narrowing)', () => {
    // A future non-fatal warning/log that merely contains "unknown variant"
    // must NOT kill a healthy process — it's only fatal in a config-load context.
    assert.equal(isFatalCodexConfigStderr('WARN something: unknown variant `foo` in the response payload'), false);
    assert.equal(isFatalCodexConfigStderr('unknown variant'), false);
  });

  it('DOES match `unknown variant` when it co-occurs with config/deserialize context', () => {
    assert.equal(isFatalCodexConfigStderr('config: unknown variant `xhigh` in `model_reasoning_effort`'), true);
    assert.equal(isFatalCodexConfigStderr('failed to deserialize: unknown variant `xhigh`'), true);
  });
});

describe('app-server-manager — P0.1/P0.2 wiring source pins', () => {
  it('findCodexBinary routes multi-candidate selection through selectBestCodexCandidate + version probe', () => {
    assert.match(managerSrc, /selectBestCodexCandidate\(/,
      'findCodexBinary must select multi-candidate via selectBestCodexCandidate');
    assert.match(managerSrc, /probeCodexVersion\(/,
      'multi-candidate path must probe `codex --version`');
  });

  it('makeStdioTransport fast-fails (fireClose) AND kills the child on fatal config stderr', () => {
    // The handler's fatal check must lead to BOTH fireClose (reject pending
    // initialize/model-list now) and SIGKILL (so the lingering old binary
    // can't hold the RPC open for its ~30s timeout). `(chunk)` (no type
    // annotation) anchors on the handler call, not the function definition.
    assert.match(
      managerSrc,
      /if \(isFatalCodexConfigStderr\(chunk\)\)[\s\S]{0,300}fireClose\(/,
      'fatal stderr must fireClose to reject pending requests immediately',
    );
    assert.match(
      managerSrc,
      /if \(isFatalCodexConfigStderr\(chunk\)\)[\s\S]{0,400}SIGKILL/,
      'fatal stderr must SIGKILL the lingering child so it cannot hold the RPC ~30s',
    );
  });
});
