import type { InfoDumpItem, InfoDumpResult, Priority } from '../types';
import { COPILOT_SYSTEM_PROMPT, type InfoDumpContext, type InfoDumpService } from './infoDump';
import { isTauriRuntime } from './copilot';

type BridgeResult = Record<string, unknown>;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export async function openGptWindow() {
  if (!isTauriRuntime()) throw new Error('ChatGPT WebView is available only in the installed TruCalenZer desktop build.');
  await invoke<void>('open_gpt_window');
}

export async function probeGptWindow() {
  return invoke<BridgeResult>('gpt_probe');
}

export async function gptStatus() {
  return invoke<{ open: boolean; url: string | null }>('gpt_status');
}

function responseText(value: BridgeResult) {
  return typeof value.response === 'string' ? value.response.trim() : '';
}

function assistantCount(value: BridgeResult) {
  return typeof value.assistantCount === 'number' ? value.assistantCount : 0;
}

type ResponseReader = () => Promise<BridgeResult>;
type Sleeper = (ms: number) => Promise<void>;

const sleep: Sleeper = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * ChatGPT streams its reply, and the stream can pause for over a second
 * mid-answer, so text stability alone returns truncated JSON. Wait for a new
 * assistant turn, then for the bridge to report it complete (completion flag
 * set and no stop button) with the text unchanged across two reads.
 */
export async function waitForCompletedResponse(
  baseline: string,
  baselineCount: number,
  read: ResponseReader = () => invoke<BridgeResult>('gpt_read_latest_response'),
  wait: Sleeper = sleep,
  timeoutMs = 120_000,
  intervalMs = 1_000,
) {
  let last = '';
  let stable = 0;
  let generating = false;
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += intervalMs) {
    await wait(intervalMs);
    const result = await read();
    const text = responseText(result);
    generating = result.generating === true;
    const isNew = assistantCount(result) > baselineCount || (text !== '' && text !== baseline);
    if (!text || !isNew) continue;
    stable = text === last ? stable + 1 : 0;
    last = text;
    // Older bridge results without the flag fall back to plain stability.
    const complete = typeof result.complete === 'boolean' ? result.complete : !generating;
    if (complete && stable >= 1) return last;
  }
  if (last && generating) {
    throw new Error('ChatGPT was still writing its reply when the local bridge timed out. Retry once ChatGPT finishes.');
  }
  throw new Error('ChatGPT did not produce a detectable response before the local bridge timed out. Use Settings → ChatGPT bridge → Test to inspect the session.');
}

/** A freshly opened window is still loading chatgpt.com; wait for the composer. */
async function waitForComposer(timeoutMs = 20_000) {
  let lastError = '';
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += 500) {
    try {
      const probe = await probeGptWindow();
      if (probe.composerPresent === true) return;
    } catch (error) {
      // Navigation in progress, or sign-in on a provider page: keep waiting.
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(lastError || 'The ChatGPT composer did not appear. Sign in to the ChatGPT window if needed, then retry.');
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced ?? text;
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('ChatGPT responded, but TruCalenZer could not find the expected JSON object.');
  return JSON.parse(source.slice(first, last + 1)) as { items?: unknown };
}

function normalizePriority(value: unknown): Priority {
  return value === 'low' || value === 'high' || value === 'normal' ? value : 'normal';
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeText(value: unknown, maxLength: number) {
  const text = nullableString(value);
  return text ? text.slice(0, maxLength) : null;
}

function normalizeIsoDate(value: unknown) {
  const text = nullableString(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

function normalizeTime(value: unknown) {
  const text = nullableString(value);
  return text && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function normalizeDuration(value: unknown) {
  const number = nullableNumber(value);
  if (number === null) return null;
  return Math.max(5, Math.min(480, Math.round(number)));
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveStudentId(rawName: unknown, context?: InfoDumpContext) {
  if (context?.studentId) return { studentId: context.studentId, unresolvedName: null as string | null };
  const name = safeText(rawName, 120);
  if (!name) return { studentId: null, unresolvedName: null as string | null };
  const roster = context?.students ?? [];
  const target = normalizeName(name);
  const exact = roster.filter((student) => normalizeName(student.displayName) === target);
  if (exact.length === 1) return { studentId: exact[0].id, unresolvedName: null as string | null };

  // A unique first-name-only result is useful for speech recognition while still
  // refusing ambiguous matches. Fuzzy edit-distance matching is deliberately not
  // used because silently assigning work to the wrong student is worse than review.
  if (!target.includes(' ')) {
    const first = roster.filter((student) => normalizeName(student.displayName).split(' ')[0] === target);
    if (first.length === 1) return { studentId: first[0].id, unresolvedName: null as string | null };
  }
  return { studentId: null, unresolvedName: name };
}

function normalizeItems(value: unknown, context?: InfoDumpContext): InfoDumpItem[] {
  if (!Array.isArray(value)) throw new Error('ChatGPT JSON did not contain an items array.');
  return value.slice(0, 20).map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`ChatGPT item ${index + 1} was not an object.`);
    const item = raw as Record<string, unknown>;
    const title = safeText(item.title, 180);
    if (!title) throw new Error(`ChatGPT item ${index + 1} did not include a title.`);
    const student = resolveStudentId(item.studentName, context);
    const notes = safeText(item.notes, 1500) ?? '';
    const unresolvedNote = student.unresolvedName
      ? `Student reference needs review: ${student.unresolvedName}.`
      : '';
    return {
      title,
      studentId: student.studentId,
      course: safeText(item.course, 120),
      dueDate: normalizeIsoDate(item.dueDate),
      possibleDate: normalizeIsoDate(item.possibleDate),
      time: normalizeTime(item.time),
      durationMinutes: normalizeDuration(item.durationMinutes),
      priority: normalizePriority(item.priority),
      notes: [notes, unresolvedNote].filter(Boolean).join('\n'),
      uncertain: item.uncertain !== false || Boolean(student.unresolvedName),
    };
  });
}

function localIsoDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildPrompt(rawText: string, context?: InfoDumpContext) {
  const roster = (context?.students ?? []).map((student) => student.displayName.trim()).filter(Boolean);
  const selectedName = context?.studentId
    ? context.students?.find((student) => student.id === context.studentId)?.displayName ?? null
    : null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local system time';
  const contextBlock = [
    `CURRENT LOCAL DATE: ${localIsoDate()}`,
    `LOCAL TIME ZONE: ${timeZone}`,
    selectedName ? `SELECTED STUDENT: ${selectedName}. All returned items belong to this student.` : 'SELECTED STUDENT: none.',
    roster.length ? `ALLOWED STUDENT NAMES: ${JSON.stringify(roster)}` : 'ALLOWED STUDENT NAMES: none supplied.',
  ].join('\n');
  return `${COPILOT_SYSTEM_PROMPT}\n\n${contextBlock}\n\nUSER TRANSCRIPT:\n${rawText.trim()}`;
}

/**
 * Optional ChatGPT organizer. ChatGPT is an additional embedded provider only:
 * Microsoft Copilot stays the primary assistant (and the only one with a
 * per-device sidecar CLI). This service talks exclusively through the
 * dedicated "gpt" WebView window at https://chatgpt.com.
 */
export class NativeGptInfoDumpService implements InfoDumpService {
  async organize(rawText: string, context?: InfoDumpContext): Promise<InfoDumpResult> {
    if (!isTauriRuntime()) throw new Error('The ChatGPT bridge is available only in the installed TruCalenZer desktop build.');

    await openGptWindow();
    await waitForComposer();

    const before = await invoke<BridgeResult>('gpt_read_latest_response');
    const baseline = responseText(before);
    const baselineCount = assistantCount(before);
    const submitted = await invoke<BridgeResult>('gpt_submit_prompt', { prompt: buildPrompt(rawText, context) });
    if (submitted.ok !== true) {
      const error = typeof submitted.error === 'string' ? submitted.error : 'ChatGPT input controls were not detected.';
      throw new Error(`${error} Sign in to the ChatGPT window if needed, then retry.`);
    }

    const last = await waitForCompletedResponse(baseline, baselineCount);
    const parsed = extractJsonObject(last);
    return {
      provider: 'gpt',
      rawText,
      items: normalizeItems(parsed.items, context),
    };
  }
}
