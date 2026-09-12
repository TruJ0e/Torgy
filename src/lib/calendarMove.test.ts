import { describe, expect, it } from 'vitest';
import { buildQuickAddTask, scheduleTaskAt } from './calendarMove';
import type { Task } from '../types';

const base: Task = {
  id: '1', studentId: 's1', course: 'CHEM 101', title: 'Chemistry Test', priority: 'normal',
  workStatus: 'todo', dueDate: '2026-09-20', possibleDate: null, scheduledAt: null,
  durationMinutes: 30, recurringRule: null, source: 'advisor', sourceRecordId: null,
  dateConfidence: 'confirmed', notes: '', originDeviceId: 'd1', createdByRole: 'coordinator',
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', version: 3, deletedAt: null,
};

describe('scheduleTaskAt', () => {
  it('sets scheduledAt without mutating the authoritative due date', () => {
    const moved = scheduleTaskAt(base, '2026-09-15T09:00:00');
    expect(moved.scheduledAt).toBe('2026-09-15T09:00:00');
    expect(moved.dueDate).toBe('2026-09-20');
    expect(moved.dateConfidence).toBe('confirmed');
  });

  it('preserves possibleDate/confidence when moving an unconfirmed task', () => {
    const possible: Task = { ...base, dateConfidence: 'possible', dueDate: null, possibleDate: '2026-09-18' };
    const moved = scheduleTaskAt(possible, '2026-09-15T14:30:00');
    expect(moved.scheduledAt).toBe('2026-09-15T14:30:00');
    expect(moved.dueDate).toBeNull();
    expect(moved.possibleDate).toBe('2026-09-18');
    expect(moved.dateConfidence).toBe('possible');
  });

  it('can clear the schedule and bumps version + updatedAt', () => {
    const before = { ...base, scheduledAt: '2026-09-15T09:00:00' };
    const cleared = scheduleTaskAt(before, null);
    expect(cleared.scheduledAt).toBeNull();
    expect(cleared.version).toBe(before.version + 1);
    expect(cleared.updatedAt).not.toBe(before.updatedAt);
  });
});

describe('buildQuickAddTask', () => {
  const task = buildQuickAddTask({
    title: '  Study group  ', studentId: 's2', scheduledAt: '2026-09-15T10:00:00',
    durationMinutes: 60, priority: 'high', deviceId: 'device-1', createdByRole: 'coordinator',
  });

  it('creates scheduled work with no authoritative due date (date safety)', () => {
    expect(task.scheduledAt).toBe('2026-09-15T10:00:00');
    expect(task.dueDate).toBeNull();
    expect(task.possibleDate).toBeNull();
    expect(task.dateConfidence).toBe('undated');
  });

  it('carries the supplied metadata and trims the title', () => {
    expect(task.title).toBe('Study group');
    expect(task.studentId).toBe('s2');
    expect(task.durationMinutes).toBe(60);
    expect(task.priority).toBe('high');
    expect(task.originDeviceId).toBe('device-1');
    expect(task.workStatus).toBe('todo');
    expect(task.version).toBe(1);
    expect(task.id).toBeTruthy();
  });

  it('stores an explicit recurrence rule without creating a due date', () => {
    const recurring = buildQuickAddTask({
      title:'Weekly review', studentId:null, scheduledAt:'2026-09-15T10:00:00', durationMinutes:30,
      priority:'normal', deviceId:'device-1', createdByRole:'coordinator', recurringRule:'FREQ=WEEKLY;BYDAY=TU',
    });
    expect(recurring.recurringRule).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(recurring.dueDate).toBeNull();
    expect(recurring.dateConfidence).toBe('undated');
  });
});
