import fs from 'node:fs';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (message) => { console.error(`PRE-FLIGHT FAILED: ${message}`); process.exitCode = 1; };

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const hooks = fs.readFileSync('src-tauri/windows/hooks.nsh', 'utf8');
const defaults = readJson('src-tauri/deployment.defaults.json');

if (pkg.version !== tauri.version) fail(`package.json version ${pkg.version} does not match tauri.conf.json ${tauri.version}.`);
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (pkg.version !== cargoVersion) fail(`package.json version ${pkg.version} does not match Cargo.toml ${cargoVersion ?? '(missing)'}.`);
if (tauri.bundle?.windows?.nsis?.installMode !== 'perMachine') fail('NSIS installer must be perMachine because the student transport worker runs as SYSTEM.');
if (tauri.bundle?.windows?.webviewInstallMode?.type !== 'offlineInstaller') fail('Windows bundle must carry the offline WebView2 installer so end-user setup does not depend on a download.');
if (!hooks.includes('/RU SYSTEM') || !hooks.includes('--sync-agent')) fail('Installer hook is missing the SYSTEM managed-sync scheduled task.');
if (!hooks.includes('icacls') || !hooks.includes('*S-1-5-32-545:(OI)(CI)M')) fail('Installer hook is missing locale-independent local encrypted-spool ACL configuration.');
if (!hooks.includes('$\\"$INSTDIR\\torgy.exe$\\" --sync-agent')) fail('Installer scheduled-task command must quote the Torgy executable path.');
if (!String(tauri.app?.security?.csp ?? '').includes("default-src 'self'")) fail('Tauri CSP no longer defaults to self-only content.');

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
];
for (const file of required) if (!fs.existsSync(file)) fail(`required release file is missing: ${file}`);

if (!process.exitCode) console.log(`Torgy ${pkg.version} release preflight passed.`);
