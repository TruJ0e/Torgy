import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { applyOutlookScheduleUpdate, clearOutlookSchedule } from './outlook';

const task: Task = {
  id: 'task-1', studentId: 's1', course: 'CHEM 101', title: 'Chemistry Test', priority: 'high', workStatus: 'todo',
  dueDate: '2026-09-11', possibleDate: null, scheduledAt: '2026-09-10T14:00:00', durationMinutes: 45, recurringRule: null,
  source: 'advisor', sourceRecordId: null, dateConfidence: 'confirmed', notes: '', originDeviceId: 'device', createdByRole: 'coordinator',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', version: 1, deletedAt: null,
};

describe('Outlook calendar boundary', () => {
  it('moves scheduled work without changing the academic due date', () => {
    const changed = applyOutlookScheduleUpdate(task, {
      start: { dateTime: '2026-09-10T20:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-10T21:00:00Z', timeZone: 'UTC' },
      subject: 'Renamed in Outlook',
    }, '2026-09-09T12:00:00Z');
    expect(changed.dueDate).toBe('2026-09-11');
    expect(changed.dateConfidence).toBe('confirmed');
    expect(changed.durationMinutes).toBe(60);
    expect(changed.title).toBe('Chemistry Test');
  });

  it('clears only the scheduled time when its linked Outlook event is deleted', () => {
    const changed = clearOutlookSchedule(task, '2026-09-09T12:00:00Z');
    expect(changed.scheduledAt).toBeNull();
    expect(changed.dueDate).toBe('2026-09-11');
    expect(changed.workStatus).toBe('todo');
  });
});
