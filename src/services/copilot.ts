import type { InfoDumpItem, InfoDumpResult, Priority } from '../types';
import { COPILOT_SYSTEM_PROMPT, type InfoDumpContext, type InfoDumpService } from './infoDump';

type BridgeResult = Record<string, unknown>;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function openCopilotWindow(url: string) {
  if (!isTauriRuntime()) throw new Error('Copilot WebView is available only in the installed Torgy desktop build.');
  await invoke<void>('open_copilot_window', { url });
}

export async function probeCopilotWindow() {
  return invoke<BridgeResult>('copilot_probe');
}

export async function copilotStatus() {
  return invoke<{ open: boolean; url: string | null }>('copilot_status');
}

function responseText(value: BridgeResult) {
  return typeof value.response === 'string' ? value.response.trim() : '';
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced ?? text;
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Copilot responded, but Torgy could not find the expected JSON object.');
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
  if (!Array.isArray(value)) throw new Error('Copilot JSON did not contain an items array.');
  return value.slice(0, 20).map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Copilot item ${index + 1} was not an object.`);
    const item = raw as Record<string, unknown>;
    const title = safeText(item.title, 180);
    if (!title) throw new Error(`Copilot item ${index + 1} did not include a title.`);
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

export class NativeCopilotInfoDumpService implements InfoDumpService {
  constructor(private readonly url: string) {}

  async organize(rawText: string, context?: InfoDumpContext): Promise<InfoDumpResult> {
    if (!this.url.trim()) throw new Error('Add the university-approved Microsoft Copilot URL in Settings first.');
    if (!isTauriRuntime()) throw new Error('The Copilot bridge is available only in the installed Torgy desktop build.');

    await openCopilotWindow(this.url);

    const before = await invoke<BridgeResult>('copilot_read_latest_response');
    const baseline = responseText(before);
    const submitted = await invoke<BridgeResult>('copilot_submit_prompt', { prompt: buildPrompt(rawText, context) });
    if (submitted.ok !== true) {
      const error = typeof submitted.error === 'string' ? submitted.error : 'Copilot input controls were not detected.';
      throw new Error(`${error} Sign in to the Copilot window if needed, then retry.`);
    }

    const timeoutAt = Date.now() + 90_000;
    let last = '';
    let stable = 0;
    while (Date.now() < timeoutAt) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const result = await invoke<BridgeResult>('copilot_read_latest_response');
      const text = responseText(result);
      if (!text || text === baseline) continue;
      if (text === last) stable += 1;
      else stable = 0;
      last = text;
      if (stable >= 2) break;
    }

    if (!last || last === baseline) {
      throw new Error('Copilot did not produce a detectable response before the local bridge timed out. Use Settings → Copilot bridge → Test to inspect the session.');
    }

    const parsed = extractJsonObject(last);
    return {
      provider: 'copilot',
      rawText,
      items: normalizeItems(parsed.items, context),
    };
  }
}
