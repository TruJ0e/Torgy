import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { reconcileIncoming } from './sync';

const task = (patch: Partial<Task> = {}): Task => ({
  id: 'advisor-copy',
  studentId: 'student-a',
  course: 'CHEM 101',
  title: 'Chemistry Test',
  priority: 'normal',
  workStatus: 'todo',
  dueDate: '2026-09-11',
  possibleDate: null,
  scheduledAt: null,
  durationMinutes: 45,
  recurringRule: null,
  source: 'advisor',
  sourceRecordId: null,
  dateConfidence: 'confirmed',
  notes: '',
  originDeviceId: 'advisor-device',
  createdByRole: 'coordinator',
  createdAt: '2026-09-09T10:00:00Z',
  updatedAt: '2026-09-09T10:00:00Z',
  version: 1,
  deletedAt: null,
  ...patch,
});

describe('offline reconciliation', () => {
  it('merges coordinator and student copies of the same test', () => {
    const existing = task();
    const incoming = task({
      id: 'student-copy',
      title: 'Chem test',
      dueDate: null,
      possibleDate: '2026-09-11',
      dateConfidence: 'possible',
      source: 'student',
      createdByRole: 'student',
      originDeviceId: 'student-device',
      updatedAt: '2026-09-09T11:00:00Z',
    });
    const result = reconcileIncoming(incoming, [existing]);
    expect(result.action).toBe('merge');
    expect(result.task.id).toBe(existing.id);
    expect(result.task.dateConfidence).toBe('confirmed');
    expect(result.task.dueDate).toBe('2026-09-11');
  });

  it('does not silently merge a worksheet with a test', () => {
    const result = reconcileIncoming(task({ id: 'worksheet', title: 'Chemistry worksheet' }), [task()]);
    expect(result.action).not.toBe('merge');
  });

  it('ignores an older version of the same task id', () => {
    const existing = task({ version: 3, updatedAt: '2026-09-09T12:00:00Z' });
    const incoming = task({ version: 2, updatedAt: '2026-09-09T13:00:00Z' });
    expect(reconcileIncoming(incoming, [existing]).action).toBe('ignore');
  });
});
