// Stages the trucalenzer-copilot sidecar binary for Tauri's `externalBin`.
// Copies src-tauri/target/release/trucalenzer-copilot[.exe] to
// src-tauri/binaries/trucalenzer-copilot-<target-triple>[.exe].
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? '.exe' : '';

let triple;
if (process.platform === 'win32') triple = 'x86_64-pc-windows-msvc';
else if (process.platform === 'darwin') triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
else triple = `${process.arch}-unknown-linux-gnu`;

const src = join(root, 'src-tauri', 'target', 'release', `trucalenzer-copilot${exe}`);
const destDir = join(root, 'src-tauri', 'binaries');
const dest = join(destDir, `trucalenzer-copilot-${triple}${exe}`);

if (!existsSync(src)) {
  console.error(`Sidecar binary not found: ${src}`);
  console.error('Build it first: cargo build --manifest-path src-tauri/Cargo.toml --release --bin trucalenzer-copilot');
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`Staged Copilot sidecar: ${dest}`);
