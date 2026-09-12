import type { Task } from '../types';

/**
 * Task list sections. Authoritative date sections (today/overdue/upcoming) use ONLY a
 * confirmed dueDate. Possible/undated tasks are never placed there — they land in
 * `needsDate` ("No date / Possible date") until a human confirms the date.
 */
export type SectionKey = 'today' | 'overdue' | 'upcoming' | 'needsDate' | 'completed';

export const SECTION_TITLES: Record<SectionKey, string> = {
  today: 'TODAY',
  overdue: 'OVERDUE',
  upcoming: 'UPCOMING',
  needsDate: 'NO DATE',
  completed: 'COMPLETED',
};

export const DEFAULT_SECTION_ORDER: SectionKey[] = ['today', 'upcoming', 'needsDate', 'completed', 'overdue'];

function isoDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Split tasks into display sections. `tasks` should already be filtered (student scope + filter).
 * Completed tasks are returned in `completed`; open tasks are bucketed by confirmed due date.
 */
export function categorizeTasks(tasks: Task[], now = Date.now()): Record<SectionKey, Task[]> {
  const today = isoDay(now);
  const open = tasks.filter((t) => t.workStatus !== 'done');
  const confirmed = open.filter((t) => t.dateConfidence === 'confirmed' && Boolean(t.dueDate));
  const byDate = (a: Task, b: Task) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.title.localeCompare(b.title);
  return {
    today: confirmed.filter((t) => t.dueDate === today).sort(byDate),
    overdue: confirmed.filter((t) => t.dueDate! < today).sort(byDate),
    upcoming: confirmed.filter((t) => t.dueDate! > today).sort(byDate),
    // Date-safety: anything not confirmed (possible or undated) stays here regardless of possibleDate.
    needsDate: open.filter((t) => t.dateConfidence !== 'confirmed' || !t.dueDate),
    completed: tasks.filter((t) => t.workStatus === 'done'),
  };
}

/** Move `source` section so it sits at `target`'s position, preserving the rest of the order. */
export function reorderSections(order: SectionKey[], source: SectionKey, target: SectionKey): SectionKey[] {
  const from = order.indexOf(source);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const copy = [...order];
  copy.splice(from, 1);
  copy.splice(to, 0, source);
  return copy;
}
