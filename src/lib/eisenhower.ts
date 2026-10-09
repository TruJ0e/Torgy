import type { InfoDumpItem } from '../types';

export type EisenhowerQuadrant = 'q1' | 'q2' | 'q3' | 'q4';

export const QUADRANT_META: Record<EisenhowerQuadrant, { title: string; hint: string }> = {
  q1: { title: 'Do First', hint: 'Urgent + Important' },
  q2: { title: 'Schedule', hint: 'Not Urgent + Important' },
  q3: { title: 'Delegate', hint: 'Urgent + Not Important' },
  q4: { title: 'Eliminate', hint: 'Neither — skipped on add' },
};

export const QUADRANT_PRIORITY: Record<EisenhowerQuadrant, InfoDumpItem['priority']> = {
  q1: 'high',
  q2: 'normal',
  q3: 'low',
  q4: 'low',
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDay(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysFromToday(d: Date | null): number | null {
  if (!d) return null;
  const today = startOfToday();
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

/**
 * Auto-place an Info Dump suggestion into an Eisenhower Matrix quadrant.
 * Priority order: Q1 → Q2 → Q3 → Q4 (first match wins).
 */
export function eisenhowerQuadrant(item: InfoDumpItem): EisenhowerQuadrant {
  const dueIn = daysFromToday(parseDay(item.dueDate));
  const possibleIn = daysFromToday(parseDay(item.possibleDate));
  // Use the most urgent date available for "any" calculations.
  const anyIn = dueIn !== null ? dueIn : possibleIn;

  const isHigh = item.priority === 'high';
  const isLow = item.priority === 'low';

  // Q1 — Do First (Urgent + Important): confirmed due soon, or high priority with a date soon.
  if (dueIn !== null && dueIn <= 2) return 'q1';
  if (isHigh && anyIn !== null && anyIn <= 7) return 'q1';

  // Q2 — Schedule (Not Urgent + Important): confirmed due later, or high priority without imminent date, or coursework with a future date.
  if (dueIn !== null) return 'q2'; // any confirmed due date beyond Q1's window
  if (isHigh) return 'q2';
  if (item.course && anyIn !== null) return 'q2';

  // Q3 — Delegate (Urgent + Not Important): unconfirmed date soon, or low priority with imminent date.
  if (possibleIn !== null && possibleIn <= 3) return 'q3';
  if (isLow && anyIn !== null && anyIn <= 7) return 'q3';
  if (item.uncertain && anyIn !== null && anyIn <= 3) return 'q3';

  // Q4 — Eliminate (Neither)
  return 'q4';
}
