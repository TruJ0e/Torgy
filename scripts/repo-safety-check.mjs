import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const blockedExtensions = /\.(?:db|sqlite|sqlite3|jsonl)$/i;
const blockedNames = /(?:^|\/)(?:\.env(?!\.example$)|credentials?|secrets?|student-data|runtime-data)(?:\/|$)/i;
const secretPatterns = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'OpenAI-style secret', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'non-empty Canvas token assignment', re: /\bCANVAS_(?:API_)?TOKEN\s*=\s*[^\s#]{8,}/i },
  { name: 'client secret assignment', re: /\b(?:client[_ -]?secret|CLIENT_SECRET)\s*[:=]\s*["']?[^\s"']{8,}/i },
];

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8').split('\0').filter(Boolean);
  } catch {
    const result = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', 'target', '.git'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else result.push(path.relative(root, full));
      }
    };
    walk(root);
    return result;
  }
}

const problems = [];
for (const file of trackedFiles()) {
  const normalized = file.replaceAll('\\', '/');
  if (blockedExtensions.test(file) || blockedNames.test(normalized)) {
    problems.push(`${file}: runtime/student/credential artifact must not be tracked`);
    continue;
  }
  let content;
  try { content = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  for (const pattern of secretPatterns) {
    if (pattern.re.test(content)) problems.push(`${file}: possible ${pattern.name}`);
  }
}

if (problems.length) {
  console.error('Repository safety check failed:\n' + problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
console.log('Repository safety check passed: no blocked runtime files or obvious secrets detected.');
