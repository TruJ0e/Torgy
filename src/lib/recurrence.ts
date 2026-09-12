import type { Task } from '../types';

/**
 * Torgy's local recurrence format is a deliberately small RRULE-like string:
 * `FREQ=WEEKLY;BYDAY=MO,WE;MOVES=2026-09-14>2026-09-15T10:30:00`.
 *
 * Only weekly rules are accepted. `MOVES` stores per-occurrence exceptions as
 * original local day -> replacement local datetime. It lets calendar drag move
 * one occurrence without changing the series start or any due-date fields.
 */
export interface WeeklyRule {
  days: number[];
  moves: Record<string, string>;
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
  return { days: [...new Set(days.length ? days : fallbackDay === null ? [] : [fallbackDay])].sort(), moves };
}

export function serializeWeeklyRule(days: number[], moves: Record<string, string> = {}): string {
  const normalized = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort();
  const moveList = Object.entries(moves).sort(([a], [b]) => a.localeCompare(b)).map(([from, to]) => `${from}>${to}`);
  return `FREQ=WEEKLY;BYDAY=${normalized.map((day) => DAY_CODES[day]).join(',')}${moveList.length ? `;MOVES=${moveList.join('|')}` : ''}`;
}

export function setWeeklyDays(rule: string | null, days: number[]): string {
  return serializeWeeklyRule(days, parseWeeklyRule(rule)?.moves);
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
  const results: CalendarOccurrence[] = [];
  for (const day of eachDay(startDay, endDay)) {
    if (day < firstDay || !rule.days.includes(new Date(`${day}T12:00:00`).getDay()) || rule.moves[day]) continue;
    results.push({ task, occurrenceDay: day, scheduledAt: `${day}T${time}`, moved: false });
  }
  for (const [occurrenceDay, scheduledAt] of Object.entries(rule.moves)) {
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
    recurringRule: serializeWeeklyRule(parsed.days, { ...parsed.moves, [occurrenceDay]: scheduledAt }),
    version: task.version + 1,
    updatedAt: now.toISOString(),
  };
}

export function recurrenceSummary(rule: string | null, scheduledAt: string | null): string | null {
  const parsed = parseWeeklyRule(rule, scheduledAt);
  if (!parsed) return null;
  return parsed.days.length === 7 ? 'Daily' : `Weekly · ${parsed.days.map((day) => DAY_CODES[day]).join(', ')}`;
}
