import type { AcademicImportRecord, AppSnapshot, DuplicateReview, Task, TaskAlias } from '../types';
import { reconcileIncoming } from './sync';

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}


const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function validYmd(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function inferYear(month: number, day: number, explicit?: number) {
  if (explicit) return explicit < 100 ? 2000 + explicit : explicit;
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day, 12);
  const staleBoundary = new Date(now);
  staleBoundary.setDate(staleBoundary.getDate() - 120);
  if (candidate < staleBoundary) year += 1;
  return year;
}

/** Extract an explicit calendar date from academic text. The result is always a suggestion, never authoritative. */
export function detectPossibleDateFromText(text: string): string | null {
  const named = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}|\d{2}))?\b/i);
  if (named) {
    const month = MONTHS[named[1].toLowerCase().replace(/\.$/, '')] ?? MONTHS[named[1].toLowerCase().slice(0, 3)];
    const day = Number(named[2]);
    const year = inferYear(month, day, named[3] ? Number(named[3]) : undefined);
    return month && validYmd(year, month, day) ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
  }
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}|\d{2}))?\b/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = inferYear(month, day, numeric[3] ? Number(numeric[3]) : undefined);
    return validYmd(year, month, day) ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
  }
  return null;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseIsoDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const direct = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [] as Record<string, string>[];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).filter((cells) => cells.some((value) => value.trim())).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function pick(row: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const key = normalizeHeader(name);
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return row[key];
  }
  return null;
}

function normalizeRow(row: Record<string, unknown>): AcademicImportRecord | null {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  const title = clean(pick(normalized, ['assignment', 'assignment name', 'title', 'task', 'name']));
  if (!title) return null;
  const status = clean(pick(normalized, ['date status', 'date confidence', 'confidence'])).toLowerCase();
  const officialExplicit = pick(normalized, ['official due date', 'canvas due date', 'due at', 'due_at']);
  const genericDate = pick(normalized, ['due date', 'date']);
  const possibleExplicit = pick(normalized, ['possible date', 'detected due date', 'inferred due date']);
  const officialDueDate = parseIsoDate(officialExplicit ?? ((status === 'confirmed' || status === 'official') ? genericDate : null));
  const explicitPossible = parseIsoDate(possibleExplicit ?? genericDate);
  const detectedPossible = detectPossibleDateFromText([title, clean(pick(normalized, ['notes', 'description']))].filter(Boolean).join(' '));
  const possibleDueDate = officialDueDate ? null : (explicitPossible ?? detectedPossible);
  return {
    studentId: clean(pick(normalized, ['student id', 'torgy student id'])) || null,
    studentName: clean(pick(normalized, ['student', 'student name'])) || null,
    course: clean(pick(normalized, ['course', 'class', 'course name'])) || null,
    title,
    officialDueDate,
    possibleDueDate,
    sourceRecordId: clean(pick(normalized, ['assignment id', 'canvas assignment id', 'source id', 'id'])) || null,
    notes: clean(pick(normalized, ['notes', 'description'])) || '',
  };
}

function parseJson(text: string): AcademicImportRecord[] {
  const parsed = JSON.parse(text) as unknown;
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).assignments)
      ? (parsed as Record<string, unknown>).assignments as unknown[]
      : [];
  return values.flatMap((item) => item && typeof item === 'object' ? [normalizeRow(item as Record<string, unknown>)].filter(Boolean) as AcademicImportRecord[] : []);
}

export function parseAcademicText(text: string, fileName = 'import.tsv', mimeType = ''): AcademicImportRecord[] {
  if (fileName.toLowerCase().endsWith('.json')) return parseJson(text);
  if (fileName.toLowerCase().endsWith('.csv') || mimeType.includes('csv')) return parseCsv(text).flatMap((row) => {
    const value = normalizeRow(row);
    return value ? [value] : [];
  });
  // Plain-text/tab-separated exports are accepted as a convenience when Docs/Sheets is exported as TSV.
  if (text.includes('\t')) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines.shift()?.split('\t').map(normalizeHeader) ?? [];
    return lines.flatMap((line) => {
      const cells = line.split('\t');
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
      const value = normalizeRow(row);
      return value ? [value] : [];
    });
  }
  throw new Error('Use a JSON, CSV, or tab-separated local export. Torgy does not upload the file anywhere.');
}

export async function parseAcademicFile(file: File): Promise<AcademicImportRecord[]> {
  return parseAcademicText(await file.text(), file.name, file.type);
}

function findStudentId(record: AcademicImportRecord, snapshot: AppSnapshot) {
  if (record.studentId && snapshot.students.some((student) => student.id === record.studentId)) return record.studentId;
  if (record.studentName) {
    const normalized = record.studentName.toLowerCase().trim();
    return snapshot.students.find((student) => student.displayName.toLowerCase().trim() === normalized)?.id ?? null;
  }
  if (snapshot.settings.role === 'student') return snapshot.students[0]?.id ?? null;
  return snapshot.settings.selectedStudentId === 'all' ? null : snapshot.settings.selectedStudentId;
}

function addAlias(aliases: TaskAlias[], aliasId: string, canonicalId: string) {
  if (!aliasId || aliasId === canonicalId) return aliases;
  return [...aliases.filter((alias) => alias.aliasId !== aliasId), { aliasId, canonicalId }];
}

export function importAcademicRecords(snapshot: AppSnapshot, records: AcademicImportRecord[]) {
  const now = new Date().toISOString();
  let tasks = [...snapshot.tasks];
  let taskAliases = [...snapshot.taskAliases];
  let duplicateReviews = [...snapshot.duplicateReviews];
  let inserted = 0;
  let updated = 0;
  let review = 0;
  for (const record of records) {
    const studentId = findStudentId(record, snapshot);
    if (!studentId) { review += 1; continue; }
    const incoming: Task = {
      id: crypto.randomUUID(),
      studentId,
      course: record.course,
      title: record.title,
      priority: 'normal',
      workStatus: 'todo',
      dueDate: record.officialDueDate,
      possibleDate: record.officialDueDate ? null : record.possibleDueDate,
      scheduledAt: null,
      durationMinutes: null,
      recurringRule: null,
      source: snapshot.settings.academicImportMode === 'docs' ? 'docs' : 'manual-import',
      sourceRecordId: record.sourceRecordId ? `import:${record.sourceRecordId}` : null,
      dateConfidence: record.officialDueDate ? 'confirmed' : record.possibleDueDate ? 'possible' : 'undated',
      notes: record.notes,
      originDeviceId: snapshot.deviceId,
      createdByRole: snapshot.settings.role,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
    };
    const result = reconcileIncoming(incoming, tasks.filter((task) => !task.deletedAt), snapshot.taskAliases);
    if (result.action === 'insert') { tasks = [result.task, ...tasks]; inserted += 1; }
    else if (result.action === 'update' || result.action === 'merge') {
      const id = result.action === 'merge' ? result.duplicateOf : result.task.id;
      tasks = tasks.map((task) => task.id === id ? result.task : task);
      if (result.action === 'merge') taskAliases = addAlias(taskAliases, incoming.id, result.duplicateOf);
      updated += 1;
    } else if (result.action === 'review') {
      const duplicate: DuplicateReview = {
        id: crypto.randomUUID(), incomingTask: result.task, possibleDuplicateId: result.possibleDuplicateId, score: result.score, createdAt: now,
      };
      duplicateReviews = [duplicate, ...duplicateReviews];
      review += 1;
    }
  }
  return { snapshot: { ...snapshot, tasks, taskAliases, duplicateReviews, updatedAt: now }, inserted, updated, review };
}
