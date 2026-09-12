import { describe, expect, it } from 'vitest';
import { applyTaskFilter, COMPLETION_WINDOW_MS, isConfirmedOverdue, isRecentlyCompleted } from './taskFilters';
import type { Task } from '../types';

const base: Task = {
  id: '1', studentId: 's1', course: 'CHEM 101', title: 'Chemistry Test', priority: 'normal',
  workStatus: 'todo', dueDate: '2026-09-10', possibleDate: null, scheduledAt: null,
  durationMinutes: null, recurringRule: null, source: 'advisor', sourceRecordId: null,
  dateConfidence: 'confirmed', notes: '', originDeviceId: 'd1', createdByRole: 'coordinator',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', version: 1, deletedAt: null,
};

const NOW = Date.parse('2026-09-11T12:00:00Z');

describe('isConfirmedOverdue', () => {
  it('returns true for confirmed past-due open task', () => {
    expect(isConfirmedOverdue({ ...base, dueDate: '2026-09-10' }, NOW)).toBe(true);
  });

  it('returns false for possible-date task (not confirmed)', () => {
    const t = { ...base, dateConfidence: 'possible' as const, dueDate: null, possibleDate: '2026-09-10' };
    expect(isConfirmedOverdue(t, NOW)).toBe(false);
  });

  it('returns false for done task', () => {
    expect(isConfirmedOverdue({ ...base, workStatus: 'done' }, NOW)).toBe(false);
  });

  it('returns false for future confirmed due date', () => {
    expect(isConfirmedOverdue({ ...base, dueDate: '2030-01-01' }, NOW)).toBe(false);
  });
});

describe('isRecentlyCompleted', () => {
  it('returns true when updatedAt is within 12h window', () => {
    const t = { ...base, workStatus: 'done' as const, updatedAt: new Date(NOW - 1000).toISOString() };
    expect(isRecentlyCompleted(t, NOW)).toBe(true);
  });

  it('returns false when updatedAt is beyond 12h window', () => {
    const t = { ...base, workStatus: 'done' as const, updatedAt: new Date(NOW - COMPLETION_WINDOW_MS - 1000).toISOString() };
    expect(isRecentlyCompleted(t, NOW)).toBe(false);
  });

  it('returns false for an open task', () => {
    expect(isRecentlyCompleted(base, NOW)).toBe(false);
  });

  it('uses completedAt so later metadata edits do not extend the 12-hour window', () => {
    const task = {
      ...base,
      workStatus: 'done' as const,
      completedAt: new Date(NOW - COMPLETION_WINDOW_MS - 1000).toISOString(),
      updatedAt: new Date(NOW - 1000).toISOString(),
    };
    expect(isRecentlyCompleted(task, NOW)).toBe(false);
  });
});

describe('applyTaskFilter', () => {
  const canvasTask: Task = { ...base, id: '2', source: 'canvas' };
  const recurringTask: Task = { ...base, id: '3', recurringRule: 'FREQ=WEEKLY' };
  const recentDone: Task = { ...base, id: '4', workStatus: 'done', updatedAt: new Date(NOW - 1000).toISOString() };
  const oldDone: Task = { ...base, id: '5', workStatus: 'done', updatedAt: new Date(NOW - COMPLETION_WINDOW_MS - 1000).toISOString() };
  const possibleOverdue: Task = { ...base, id: '6', dateConfidence: 'possible', dueDate: null, possibleDate: '2026-09-10' };
  const tasks = [base, canvasTask, recurringTask, recentDone, oldDone, possibleOverdue];

  it('all: includes open tasks and recently completed; excludes old completed', () => {
    const ids = applyTaskFilter(tasks, 'all', NOW).map(t => t.id);
    expect(ids).toContain('1');
    expect(ids).toContain('4'); // recent done
    expect(ids).not.toContain('5'); // old done
  });

  it('advisor: filters to advisor source; excludes canvas and old completed', () => {
    const ids = applyTaskFilter(tasks, 'advisor', NOW).map(t => t.id);
    expect(ids).toContain('1');
    expect(ids).not.toContain('2'); // canvas source
    expect(ids).not.toContain('5'); // old done
  });

  it('canvas: returns only canvas-sourced tasks', () => {
    const ids = applyTaskFilter(tasks, 'canvas', NOW).map(t => t.id);
    expect(ids).toEqual(['2']);
  });

  it('recurring: includes only tasks with recurringRule set', () => {
    const ids = applyTaskFilter(tasks, 'recurring', NOW).map(t => t.id);
    expect(ids).toContain('3');
    expect(ids).not.toContain('1');
  });

  it('overdue: confirmed overdue only; excludes possible-overdue and done', () => {
    const ids = applyTaskFilter(tasks, 'overdue', NOW).map(t => t.id);
    expect(ids).toContain('1'); // confirmed + past due
    expect(ids).not.toContain('6'); // possible date — not confirmed
    expect(ids).not.toContain('4'); // done
  });

  it('completed: shows all done tasks regardless of age', () => {
    const ids = applyTaskFilter(tasks, 'completed', NOW).map(t => t.id);
    expect(ids).toContain('4'); // recent done
    expect(ids).toContain('5'); // old done — visible in completed filter
    expect(ids).not.toContain('1'); // open
  });
});
