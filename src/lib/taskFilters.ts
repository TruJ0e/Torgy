import type { Task } from '../types';

export type TaskFilter = 'all' | 'advisor' | 'canvas' | 'recurring' | 'overdue' | 'completed';

export const COMPLETION_WINDOW_MS = 12 * 60 * 60 * 1000;

function isoDay(now: number) { const date=new Date(now);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

export function isConfirmedOverdue(task: Task, now = Date.now()): boolean {
  return task.workStatus !== 'done'
    && task.dateConfidence === 'confirmed'
    && Boolean(task.dueDate && task.dueDate < isoDay(now));
}

export function isRecentlyCompleted(task: Task, now = Date.now()): boolean {
  const completedAt = task.completedAt ?? task.updatedAt;
  return task.workStatus === 'done'
    && Boolean(completedAt)
    && now - Date.parse(completedAt) < COMPLETION_WINDOW_MS;
}

/**
 * Filter tasks for display. For 'all'/'advisor'/'canvas'/'recurring', completed tasks are
 * included only within the 12-hour recency window. 'completed' shows all done tasks.
 * 'overdue' shows only confirmed-overdue open tasks.
 */
export function applyTaskFilter(tasks: Task[], filter: TaskFilter, now = Date.now()): Task[] {
  if (filter === 'completed') return tasks.filter(t => t.workStatus === 'done');
  if (filter === 'overdue') return tasks.filter((task) => isConfirmedOverdue(task, now));

  const matchesSource = (t: Task): boolean => {
    if (filter === 'all') return true;
    if (filter === 'advisor') return t.source === 'advisor';
    if (filter === 'canvas') return t.source === 'canvas';
    if (filter === 'recurring') return t.recurringRule !== null;
    return true;
  };

  return tasks.filter(t => matchesSource(t) && (t.workStatus !== 'done' || isRecentlyCompleted(t, now)));
}
