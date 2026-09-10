import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src-tauri/deployment.defaults.json');
const current = JSON.parse(fs.readFileSync(file, 'utf8'));
const map = {
  copilotUrl: 'TORGY_COPILOT_URL',
  outlookTenantId: 'TORGY_OUTLOOK_TENANT_ID',
  outlookClientId: 'TORGY_OUTLOOK_CLIENT_ID',
  syncSharePath: 'TORGY_SYNC_SHARE_PATH',
  canvasBaseUrl: 'TORGY_CANVAS_BASE_URL',
};
for (const [key, env] of Object.entries(map)) {
  if (process.env[env]) current[key] = process.env[env];
}
fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
console.log('Torgy deployment defaults prepared. No passwords/tokens are accepted by this script.');
