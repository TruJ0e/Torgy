import { describe, expect, it } from 'vitest';
import { duplicateScore, mergeDuplicateTasks, shouldAutoMerge, taskFingerprint } from './dedupe';
import type { Task } from '../types';

const base: Task = {
  id: '1', studentId: 's1', course: 'CHEM 101', title: 'Chemistry Test', priority: 'normal',
  workStatus: 'todo', dueDate: '2026-09-11', possibleDate: null, scheduledAt: null,
  durationMinutes: null, recurringRule: null, source: 'advisor', sourceRecordId: null,
  dateConfidence: 'confirmed', notes: '', originDeviceId: 'd1', createdByRole: 'coordinator',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', version: 1, deletedAt: null,
};

describe('dedupe', () => {
  it('matches deterministic fingerprints', () => {
    const other = { ...base, id: '2' };
    expect(taskFingerprint(base)).toBe(taskFingerprint(other));
  });

  it('finds an independently-created equivalent task', () => {
    const other = { ...base, id: '2', title: 'Chem test' };
    expect(duplicateScore(base, other)).toBeGreaterThanOrEqual(0.93);
    expect(shouldAutoMerge(base, other)).toBe(true);
  });

  it('does not merge different students', () => {
    const other = { ...base, id: '2', studentId: 's2' };
    expect(duplicateScore(base, other)).toBe(0);
  });

  it('keeps a chemistry worksheet separate from a chemistry test', () => {
    const other = { ...base, id: '2', title: 'Chemistry worksheet' };
    expect(shouldAutoMerge(base, other)).toBe(false);
  });

  it('prefers a confirmed date while merging', () => {
    const possible: Task = {
      ...base,
      id: '2',
      dueDate: null,
      possibleDate: '2026-09-11',
      dateConfidence: 'possible',
      version: 2,
      updatedAt: '2026-09-10T00:00:00Z',
    };
    const merged = mergeDuplicateTasks(base, possible);
    expect(merged.dateConfidence).toBe('confirmed');
    expect(merged.dueDate).toBe('2026-09-11');
    expect(merged.possibleDate).toBeNull();
  });
});
