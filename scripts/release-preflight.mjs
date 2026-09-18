import fs from 'node:fs';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (message) => { console.error(`PRE-FLIGHT FAILED: ${message}`); process.exitCode = 1; };

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const mainRust = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const libRust = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const syncRust = fs.readFileSync('src-tauri/src/sync.rs', 'utf8');
const appTsx = fs.readFileSync('src/App.tsx', 'utf8');
const agentRust = fs.readFileSync('src-tauri/src/bin/torgy-machine-agent.rs', 'utf8');
const agentNsis = fs.readFileSync('src-tauri/windows/machine-agent.nsi', 'utf8');
const agentBuildScript = fs.readFileSync('scripts/build-machine-agent-installer.mjs', 'utf8');
const defaults = readJson('src-tauri/deployment.defaults.json');

if (pkg.version !== tauri.version) fail(`package.json version ${pkg.version} does not match tauri.conf.json ${tauri.version}.`);
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (pkg.version !== cargoVersion) fail(`package.json version ${pkg.version} does not match Cargo.toml ${cargoVersion ?? '(missing)'}.`);

const nsis = tauri.bundle?.windows?.nsis;
if (tauri.mainBinaryName !== 'torgy') fail('Tauri mainBinaryName must explicitly target the user-facing torgy binary.');
if (!String(pkg.scripts?.['desktop:build'] ?? '').includes('torgy-machine-agent') || !String(pkg.scripts?.['desktop:build'] ?? '').includes('build-machine-agent-installer.mjs')) fail('desktop:build must produce both the current-user desktop installer and Machine Agent package for the existing release workflow.');
if (nsis?.installMode !== 'currentUser') fail('Desktop NSIS installer must be currentUser so routine Torgy updates never require elevation.');
if (Object.prototype.hasOwnProperty.call(nsis ?? {}, 'installerHooks')) fail('Desktop NSIS installer must not run privileged installer hooks.');
if (tauri.bundle?.windows?.webviewInstallMode?.type !== 'offlineInstaller') fail('Windows bundle must carry the offline WebView2 installer so end-user setup does not depend on a download.');
if (!String(tauri.app?.security?.csp ?? '').includes("default-src 'self'")) fail('Tauri CSP no longer defaults to self-only content.');

if (!cargo.includes('name = "torgy-machine-agent"') || !cargo.includes('path = "src/bin/torgy-machine-agent.rs"')) fail('Cargo is missing the dedicated Torgy Machine Agent binary.');
if (mainRust.includes('--sync-agent') || mainRust.includes('--configure-agent') || libRust.includes('handle_cli_mode')) fail('User-updatable Torgy desktop binary must not expose privileged machine-agent CLI modes.');
if (!agentRust.includes('--configure-agent=') || !agentRust.includes('run_machine_agent')) fail('Machine Agent binary is missing its protected run/configuration entry points.');
if (!syncRust.includes('join("Torgy Machine Agent")') || !syncRust.includes('join("torgy-machine-agent.exe")')) fail('Elevated agent configuration must target the protected Program Files Machine Agent binary.');
if (syncRust.includes('std::env::current_exe().map_err(|e| format!("Could not locate Torgy executable')) fail('Managed-agent elevation must never execute the current-user Torgy binary as administrator.');
if (!syncRust.includes('legacy_per_machine_install') || !appTsx.includes('Legacy per-machine Torgy is still installed')) fail('0.4.4 must surface any leftover legacy Program Files installation after current-user migration.');

if (!agentNsis.includes('RequestExecutionLevel admin')) fail('Machine Agent installer must explicitly require administrator approval.');
if (!agentNsis.includes('$PROGRAMFILES64\\Torgy Machine Agent')) fail('Machine Agent must install under protected Program Files.');
if (!agentNsis.includes('/RU SYSTEM') || !agentNsis.includes('torgy-machine-agent.exe')) fail('Machine Agent installer is missing the SYSTEM scheduled task.');
if (!agentNsis.includes('icacls') || !agentNsis.includes('*S-1-5-32-545:(OI)(CI)M')) fail('Machine Agent installer is missing locale-independent encrypted-spool ACL configuration.');
if (agentNsis.includes('torgy.exe --sync-agent') || agentNsis.includes('$INSTDIR\\torgy.exe')) fail('SYSTEM task must never execute the user-facing Torgy binary.');
if (agentNsis.includes('RMDir /r "$ProgramData\\Torgy"')) fail('Machine Agent uninstall must preserve ProgramData transport/configuration state.');
if (!agentNsis.includes('LEGACY_UNINSTALL_KEY') || !agentNsis.includes('MigrationBackup') || !agentNsis.includes('xcopy /E /I /H /Y')) fail('Machine Agent installer must preserve ProgramData while migrating a legacy per-machine Torgy install.');
if (!agentNsis.includes('ReadEnvStr $ProgramData "ProgramData"')) fail('Machine Agent installer must resolve ProgramData through the Windows environment.');
if (!agentBuildScript.includes("'/WX'")) fail('Machine Agent NSIS build must treat warnings as errors.');

const forbiddenDefaultNames = ['token', 'password', 'secret', 'refreshToken', 'accessToken'];
for (const key of Object.keys(defaults)) {
  if (forbiddenDefaultNames.some((name) => key.toLowerCase().includes(name.toLowerCase()))) fail(`deployment.defaults.json contains forbidden secret-like key ${key}.`);
}

const required = [
  'src/services/sync.e2e.test.ts',
  'src/services/academicImport.test.ts',
  'src/services/outlook.test.ts',
  'src/services/persistence.test.ts',
  'src/services/readiness.ts',
  'src-tauri/src/copilot.rs',
  'src-tauri/src/sync.rs',
  'src-tauri/src/outlook.rs',
  'src-tauri/src/canvas.rs',
  'src-tauri/src/bin/torgy-machine-agent.rs',
  'src-tauri/windows/machine-agent.nsi',
  'scripts/build-machine-agent-installer.mjs',
];
for (const file of required) if (!fs.existsSync(file)) fail(`required release file is missing: ${file}`);

if (!process.exitCode) console.log(`Torgy ${pkg.version} hybrid release preflight passed.`);
