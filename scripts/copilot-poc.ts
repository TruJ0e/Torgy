import { chromium, type Locator, type Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Local Copilot browser bridge proof-of-concept.
 *
 * Security boundary:
 * - Uses the installed Microsoft Edge channel and a Torgy-owned local browser profile.
 * - The employee signs in to Microsoft normally.
 * - Does not read cookies, localStorage, sessionStorage, auth headers, or credentials.
 * - Only interacts with visible page controls and visible response text.
 *
 * This is intentionally a diagnostic/PoC script. The production bridge belongs behind
 * Torgy's native WebView boundary so it can be replaced if Microsoft changes its UI.
 */

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const url = process.env.COPILOT_URL ?? argValue('--url');
const promptFile = argValue('--prompt-file');
const promptArg = argValue('--prompt');
const inspectOnly = args.includes('--inspect');
const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS ?? '90000');

if (!url) {
  console.error('Set COPILOT_URL or pass --url with the university-approved Microsoft Copilot URL.');
  process.exit(1);
}

if (!url.startsWith('https://')) {
  console.error('COPILOT_URL must use HTTPS.');
  process.exit(1);
}

const profile = process.env.TORGY_COPILOT_PROFILE ?? path.join(os.homedir(), '.torgy', 'copilot-profile');
const prompt = promptFile
  ? fs.readFileSync(path.resolve(promptFile), 'utf8')
  : promptArg;

async function visible(locator: Locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function findInput(page: Page): Promise<Locator | null> {
  const configured = process.env.COPILOT_INPUT_SELECTOR;
  const candidates: Locator[] = [];
  if (configured) candidates.push(page.locator(configured).last());
  candidates.push(
    page.getByRole('textbox').last(),
    page.locator('textarea:not([disabled])').last(),
    page.locator('[contenteditable="true"][role="textbox"]').last(),
    page.locator('[contenteditable="true"]').last(),
  );

  for (const candidate of candidates) {
    if (await visible(candidate)) return candidate;
  }
  return null;
}

async function findSend(page: Page): Promise<Locator | null> {
  const configured = process.env.COPILOT_SEND_SELECTOR;
  const candidates: Locator[] = [];
  if (configured) candidates.push(page.locator(configured).last());
  candidates.push(
    page.getByRole('button', { name: /send|submit/i }).last(),
    page.locator('button[aria-label*="send" i]').last(),
    page.locator('button[title*="send" i]').last(),
  );
  for (const candidate of candidates) {
    if (await visible(candidate) && await candidate.isEnabled().catch(() => false)) return candidate;
  }
  return null;
}

async function visibleTextCandidates(page: Page) {
  return page.evaluate(() => {
    const isVisible = (el: Element) => {
      const node = el as HTMLElement;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const selector = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="response" i]',
      '[data-testid*="message" i]',
      '[role="article"]',
      'article',
    ].join(',');
    const seen = new Set<string>();
    return [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        testId: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((item) => item.text.length >= 10 && !seen.has(item.text) && (seen.add(item.text), true))
      .slice(-30);
  });
}

async function readLatestResponse(page: Page): Promise<string> {
  const configured = process.env.COPILOT_RESPONSE_SELECTOR;
  if (configured) {
    const locator = page.locator(configured).last();
    if (await visible(locator)) return (await locator.innerText()).trim();
  }

  const candidates = await visibleTextCandidates(page);
  if (!candidates.length) return '';
  return candidates[candidates.length - 1]?.text ?? '';
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced ?? text;
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  const candidate = source.slice(first, last + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1180, height: 820 },
});
const pages = context.pages();
const page = pages[0] ?? await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });

console.log(`Copilot opened at ${new URL(url).host} in a persistent local Edge profile.`);
console.log('Sign in normally if Microsoft prompts you. Torgy does not read authentication storage.');

if (inspectOnly) {
  await page.waitForTimeout(2500);
  const input = await findInput(page);
  const send = await findSend(page);
  const candidates = await visibleTextCandidates(page);
  console.log(JSON.stringify({
    inputFound: Boolean(input),
    sendButtonFound: Boolean(send),
    visibleMessageCandidates: candidates,
  }, null, 2));
  await context.close();
  process.exit(0);
}

if (!prompt) {
  console.log('No prompt supplied. Keeping the window open for manual sign-in/inspection.');
  console.log('Use --inspect, --prompt "...", or --prompt-file <path> on the next run.');
  await page.waitForTimeout(60 * 60 * 1000);
  await context.close();
  process.exit(0);
}

const input = await findInput(page);
if (!input) {
  console.error('Could not find a visible Copilot input. Run with --inspect after signing in, then set COPILOT_INPUT_SELECTOR if needed.');
  await context.close();
  process.exit(2);
}

const baseline = await readLatestResponse(page);
await input.click();
const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
if (tagName === 'textarea' || tagName === 'input') {
  await input.fill(prompt);
} else {
  await input.press('Control+A').catch(() => undefined);
  await input.fill(prompt).catch(async () => {
    await input.evaluate((el, value) => {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }, prompt);
  });
}

const send = await findSend(page);
if (send) {
  await send.click();
} else {
  // Normal keyboard input through Playwright is a trusted browser event, unlike synthetic DOM KeyboardEvent dispatch.
  await input.press('Enter');
}

console.log('Prompt submitted. Waiting for a visible Copilot response…');
const started = Date.now();
let previous = '';
let stableCount = 0;
let latest = '';
while (Date.now() - started < timeoutMs) {
  await page.waitForTimeout(1000);
  latest = await readLatestResponse(page);
  if (!latest || latest === baseline) continue;
  if (latest === previous) stableCount += 1;
  else stableCount = 0;
  previous = latest;
  if (stableCount >= 2) break;
}

if (!latest || latest === baseline) {
  console.error('A new response was not detected. Run --inspect and configure COPILOT_RESPONSE_SELECTOR for this Microsoft Copilot experience.');
  await context.close();
  process.exit(3);
}

console.log('\n--- COPILOT RESPONSE ---\n');
console.log(latest);
const json = extractJson(latest);
if (json) {
  console.log('\n--- PARSED JSON ---\n');
  console.log(JSON.stringify(JSON.parse(json), null, 2));
} else {
  console.warn('\nNo valid JSON object was found in the visible response.');
}

await context.close();
