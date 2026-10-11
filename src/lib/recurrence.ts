import type { Task } from '../types';

/**
 * Torgy's local recurrence format is a deliberately small RRULE-like string:
 * `FREQ=WEEKLY;BYDAY=MO,WE;MOVES=2026-09-14>2026-09-15T10:30:00;DONES=2026-09-21`.
 *
 * Only weekly rules are accepted. `MOVES` stores per-occurrence exceptions as
 * original local day -> replacement local datetime. It lets calendar drag move
 * one occurrence without changing the series start or any due-date fields.
 * `DONES` stores occurrence days (YYYY-MM-DD) that were completed or removed
 * individually; they no longer expand into upcoming instances.
 */
export interface WeeklyRule {
  days: number[];
  moves: Record<string, string>;
  dones: string[];
}

export interface CalendarOccurrence {
  task: Task;
  occurrenceDay: string;
  scheduledAt: string;
  moved: boolean;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseWeeklyRule(rule: string | null, scheduledAt: string | null = null): WeeklyRule | null {
  if (!rule) return null;
  const fields = Object.fromEntries(rule.split(';').map((part) => {
    const at = part.indexOf('=');
    return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
  }));
  if (fields.FREQ !== 'WEEKLY') return null;
  const fallbackDay = scheduledAt ? new Date(scheduledAt).getDay() : null;
  const days = (fields.BYDAY ?? '').split(',').map((code) => DAY_CODES.indexOf(code)).filter((day) => day >= 0);
  const moves: Record<string, string> = {};
  for (const item of (fields.MOVES ?? '').split('|').filter(Boolean)) {
    const split = item.indexOf('>');
    const from = item.slice(0, split);
    const to = item.slice(split + 1);
    if (split > 0 && /^\d{4}-\d{2}-\d{2}$/.test(from) && !Number.isNaN(Date.parse(to))) moves[from] = to;
  }
  const dones = (fields.DONES ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return { days: [...new Set(days.length ? days : fallbackDay === null ? [] : [fallbackDay])].sort(), moves, dones: [...new Set(dones)].sort() };
}

export function serializeWeeklyRule(days: number[], moves: Record<string, string> = {}, dones: string[] = []): string {
  const normalized = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort();
  const moveList = Object.entries(moves).sort(([a], [b]) => a.localeCompare(b)).map(([from, to]) => `${from}>${to}`);
  const doneList = [...new Set(dones)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return `FREQ=WEEKLY;BYDAY=${normalized.map((day) => DAY_CODES[day]).join(',')}${moveList.length ? `;MOVES=${moveList.join('|')}` : ''}${doneList.length ? `;DONES=${doneList.join(',')}` : ''}`;
}

export function setWeeklyDays(rule: string | null, days: number[]): string {
  const parsed = parseWeeklyRule(rule);
  return serializeWeeklyRule(days, parsed?.moves, parsed?.dones);
}

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function eachDay(startDay: string, endDay: string): string[] {
  const current = new Date(`${startDay}T12:00:00`);
  const end = new Date(`${endDay}T12:00:00`);
  const days: string[] = [];
  while (current <= end) {
    days.push(localDay(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

export function occurrencesBetween(task: Task, startDay: string, endDay: string): CalendarOccurrence[] {
  if (!task.scheduledAt) return [];
  const rule = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!rule) {
    const day = task.scheduledAt.slice(0, 10);
    return day >= startDay && day <= endDay ? [{ task, occurrenceDay: day, scheduledAt: task.scheduledAt, moved: false }] : [];
  }
  const firstDay = task.scheduledAt.slice(0, 10);
  const time = task.scheduledAt.slice(11, 19) || '09:00:00';
  const doneSet = new Set(rule.dones);
  const results: CalendarOccurrence[] = [];
  for (const day of eachDay(startDay, endDay)) {
    if (day < firstDay || doneSet.has(day) || !rule.days.includes(new Date(`${day}T12:00:00`).getDay()) || rule.moves[day]) continue;
    results.push({ task, occurrenceDay: day, scheduledAt: `${day}T${time}`, moved: false });
  }
  for (const [occurrenceDay, scheduledAt] of Object.entries(rule.moves)) {
    if (doneSet.has(occurrenceDay)) continue;
    const movedDay = scheduledAt.slice(0, 10);
    if (movedDay >= startDay && movedDay <= endDay) results.push({ task, occurrenceDay, scheduledAt, moved: true });
  }
  return results.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export function moveRecurringOccurrence(task: Task, occurrenceDay: string, scheduledAt: string, now = new Date()): Task {
  const parsed = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!parsed) return task;
  return {
    ...task,
    recurringRule: serializeWeeklyRule(parsed.days, { ...parsed.moves, [occurrenceDay]: scheduledAt }, parsed.dones),
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
}

/**
 * Mark one occurrence done (or remove it). The day joins DONES so it no
 * longer expands into upcoming instances; the series itself keeps going.
 */
export function excludeRecurringOccurrence(task: Task, occurrenceDay: string, now = new Date()): Task {
  const parsed = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!parsed || parsed.dones.includes(occurrenceDay)) return task;
  return {
    ...task,
    recurringRule: serializeWeeklyRule(parsed.days, parsed.moves, [...parsed.dones, occurrenceDay]),
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
}

/** Undo for excludeRecurringOccurrence: drop the day back out of DONES. */
export function restoreRecurringOccurrence(task: Task, occurrenceDay: string, now = new Date()): Task {
  const parsed = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!parsed || !parsed.dones.includes(occurrenceDay)) return task;
  return {
    ...task,
    recurringRule: serializeWeeklyRule(parsed.days, parsed.moves, parsed.dones.filter((d) => d !== occurrenceDay)),
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
}

/** Next series weekday strictly after `afterDay` that isn't done. Null when the rule is unusable. */
export function nextOccurrenceDay(task: Task, afterDay: string): string | null {
  const parsed = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!parsed || !parsed.days.length) return null;
  const doneSet = new Set(parsed.dones);
  const cursor = new Date(`${afterDay}T12:00:00`);
  for (let i = 0; i < 70; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const day = localDay(cursor);
    if (parsed.days.includes(cursor.getDay()) && !doneSet.has(day)) return day;
  }
  return null;
}

/** Next series weekday on or after `fromDay` that isn't done. */
export function occurrenceDayOnOrAfter(task: Task, fromDay: string): string | null {
  const parsed = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!parsed || !parsed.days.length) return null;
  const doneSet = new Set(parsed.dones);
  const cursor = new Date(`${fromDay}T12:00:00`);
  if (Number.isNaN(cursor.getTime())) return null;
  for (let i = 0; i < 70; i++) {
    const day = localDay(cursor);
    if (parsed.days.includes(cursor.getDay()) && !doneSet.has(day)) return day;
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

/**
 * Move the entire series so the grabbed occurrence lands on `newIso`.
 * The weekday pattern shifts by the same delta (MO,WE,FR dragged Wed->Thu
 * becomes TU,TH,SA); moves and the anchor shift with it, dones stay put
 * as history.
 */
export function moveRecurringSeries(task: Task, occurrenceDay: string, newIso: string, now = new Date()): Task {
  const parsed = parseWeeklyRule(task.recurringRule, task.scheduledAt);
  if (!parsed) return task;
  const newDay = newIso.slice(0, 10);
  const newTime = newIso.slice(11, 19) || '09:00:00';
  const deltaDays = Math.round((new Date(`${newDay}T12:00:00`).getTime() - new Date(`${occurrenceDay}T12:00:00`).getTime()) / 86400000);
  if (!Number.isFinite(deltaDays)) return task;
  const shiftDay = (day: string): string => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + deltaDays);
    return localDay(d);
  };
  const shiftDateTime = (iso: string): string => `${shiftDay(iso.slice(0, 10))}T${iso.slice(11, 19) || newTime}`;
  const newDays = [...new Set(parsed.days.map((dow) => (((dow + deltaDays) % 7) + 7) % 7))].sort((a, b) => a - b);
  const newMoves: Record<string, string> = {};
  for (const [from, to] of Object.entries(parsed.moves)) newMoves[shiftDay(from)] = shiftDateTime(to);
  const shiftedAnchorDay = task.scheduledAt ? shiftDay(task.scheduledAt.slice(0, 10)) : newDay;
  return {
    ...task,
    scheduledAt: task.scheduledAt ? `${shiftedAnchorDay}T${newTime}` : task.scheduledAt,
    dueDate: task.dueDate ? shiftDay(task.dueDate) : task.dueDate,
    possibleDate: task.possibleDate ? shiftDay(task.possibleDate) : task.possibleDate,
    recurringRule: serializeWeeklyRule(newDays, newMoves, parsed.dones),
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
}

export function recurrenceSummary(rule: string | null, scheduledAt: string | null): string | null {
  const parsed = parseWeeklyRule(rule, scheduledAt);
  if (!parsed) return null;
  return parsed.days.length === 7 ? 'Daily' : `Weekly · ${parsed.days.map((day) => DAY_CODES[day]).join(', ')}`;
}
