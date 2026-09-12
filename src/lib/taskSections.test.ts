import { describe, expect, it } from 'vitest';
import { categorizeTasks, DEFAULT_SECTION_ORDER, reorderSections } from './taskSections';
import type { Task } from '../types';

const base: Task = {
  id: '1', studentId: 's1', course: 'CHEM 101', title: 'Chemistry Test', priority: 'normal',
  workStatus: 'todo', dueDate: null, possibleDate: null, scheduledAt: null,
  durationMinutes: null, recurringRule: null, source: 'advisor', sourceRecordId: null,
  dateConfidence: 'undated', notes: '', originDeviceId: 'd1', createdByRole: 'coordinator',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', version: 1, deletedAt: null,
};

const NOW = Date.parse('2026-09-11T12:00:00Z'); // today = 2026-09-11

describe('categorizeTasks', () => {
  const todayTask: Task = { ...base, id: 'today', dateConfidence: 'confirmed', dueDate: '2026-09-11' };
  const overdueTask: Task = { ...base, id: 'over', dateConfidence: 'confirmed', dueDate: '2026-09-01' };
  const upcomingTask: Task = { ...base, id: 'up', dateConfidence: 'confirmed', dueDate: '2026-09-20' };
  const possibleTodayTask: Task = { ...base, id: 'poss', dateConfidence: 'possible', possibleDate: '2026-09-11' };
  const possibleOverdueTask: Task = { ...base, id: 'possOver', dateConfidence: 'possible', possibleDate: '2026-09-01' };
  const undatedTask: Task = { ...base, id: 'und', dateConfidence: 'undated' };
  const doneTask: Task = { ...base, id: 'done', workStatus: 'done', dateConfidence: 'confirmed', dueDate: '2026-09-11' };
  const tasks = [todayTask, overdueTask, upcomingTask, possibleTodayTask, possibleOverdueTask, undatedTask, doneTask];
  const result = categorizeTasks(tasks, NOW);

  it('places confirmed due-today tasks in today', () => {
    expect(result.today.map((t) => t.id)).toEqual(['today']);
  });

  it('places confirmed past-due tasks in overdue', () => {
    expect(result.overdue.map((t) => t.id)).toEqual(['over']);
  });

  it('places confirmed future tasks in upcoming', () => {
    expect(result.upcoming.map((t) => t.id)).toEqual(['up']);
  });

  it('NEVER places possible dates in today/overdue/upcoming (date safety)', () => {
    const authoritativeIds = [...result.today, ...result.overdue, ...result.upcoming].map((t) => t.id);
    expect(authoritativeIds).not.toContain('poss');
    expect(authoritativeIds).not.toContain('possOver');
  });

  it('keeps possible and undated tasks in needsDate', () => {
    expect(result.needsDate.map((t) => t.id).sort()).toEqual(['poss', 'possOver', 'und']);
  });

  it('separates completed tasks and excludes them from open sections', () => {
    expect(result.completed.map((t) => t.id)).toEqual(['done']);
    expect(result.today.map((t) => t.id)).not.toContain('done');
  });
});

describe('reorderSections', () => {
  it('moves a section to the target position', () => {
    expect(reorderSections(DEFAULT_SECTION_ORDER, 'completed', 'today')).toEqual([
      'completed', 'today', 'upcoming', 'needsDate', 'overdue',
    ]);
  });

  it('returns the same order when source equals target', () => {
    expect(reorderSections(DEFAULT_SECTION_ORDER, 'today', 'today')).toBe(DEFAULT_SECTION_ORDER);
  });

  it('does not mutate the input order', () => {
    const input = [...DEFAULT_SECTION_ORDER];
    reorderSections(input, 'today', 'completed');
    expect(input).toEqual(DEFAULT_SECTION_ORDER);
  });
});
