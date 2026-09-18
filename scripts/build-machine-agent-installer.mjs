import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const targetIndex = process.argv.indexOf('--target');
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : '';
if (targetIndex >= 0 && !target) throw new Error('--target requires a Rust target triple.');

const releaseDir = path.resolve(root, 'src-tauri', 'target', ...(target ? [target] : []), 'release');
const agentExe = path.join(releaseDir, 'torgy-machine-agent.exe');
if (!fs.existsSync(agentExe)) throw new Error(`Machine-agent binary not found: ${agentExe}`);

const outDir = path.join(releaseDir, 'bundle', 'nsis');
fs.mkdirSync(outDir, { recursive: true });
const script = path.resolve(root, 'src-tauri', 'windows', 'machine-agent.nsi');
const nsisPath = (value) => process.platform === 'win32' ? path.resolve(value) : path.resolve(value).replaceAll('\\\\', '/');
const args = [
  '/WX',
  `-DVERSION=${pkg.version}`,
  `-DAGENT_EXE=${nsisPath(agentExe)}`,
  `-DOUT_DIR=${nsisPath(outDir)}`,
  nsisPath(script),
];

const candidates = process.platform === 'win32'
  ? [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'tauri', 'NSIS', 'makensis.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'tauri', 'NSIS', 'Bin', 'makensis.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'NSIS', 'makensis.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'NSIS', 'makensis.exe'),
      'makensis.exe',
      'makensis',
    ].filter(Boolean)
  : ['makensis'];
let lastError = null;
for (const command of candidates) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') { lastError = result.error; continue; }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const output = path.join(outDir, `Torgy_Machine_Agent_${pkg.version}_x64-setup.exe`);
  if (!fs.existsSync(output)) throw new Error(`NSIS completed but the machine-agent installer was not found: ${output}`);
  console.log(`Built Torgy Machine Agent installer: ${output}`);
  process.exit(0);
}
throw lastError ?? new Error('makensis was not found in PATH.');
