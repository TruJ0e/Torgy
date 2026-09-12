import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { moveRecurringOccurrence, occurrencesBetween, parseWeeklyRule, serializeWeeklyRule } from './recurrence';

const task: Task = {
  id:'r1', studentId:'s1', course:null, title:'Study', priority:'normal', workStatus:'todo',
  dueDate:null, possibleDate:'2026-09-30', scheduledAt:'2026-09-07T09:30:00', durationMinutes:30,
  recurringRule:'FREQ=WEEKLY;BYDAY=MO,WE', source:'advisor', sourceRecordId:null,
  dateConfidence:'possible', notes:'', originDeviceId:'d1', createdByRole:'coordinator',
  createdAt:'2026-09-01T00:00:00Z', updatedAt:'2026-09-01T00:00:00Z', version:1, deletedAt:null,
};

describe('weekly recurrence', () => {
  it('serializes and parses the documented local rule', () => {
    const rule = serializeWeeklyRule([3, 1, 1]);
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(parseWeeklyRule(rule)).toEqual({ days:[1, 3], moves:{} });
  });

  it('renders occurrences on selected weekdays at the series time', () => {
    expect(occurrencesBetween(task, '2026-09-07', '2026-09-13').map((item) => item.scheduledAt)).toEqual([
      '2026-09-07T09:30:00', '2026-09-09T09:30:00',
    ]);
  });

  it('moves one occurrence without changing the series start or date safety fields', () => {
    const moved = moveRecurringOccurrence(task, '2026-09-09', '2026-09-10T14:00:00', new Date('2026-09-08T00:00:00Z'));
    expect(moved.scheduledAt).toBe(task.scheduledAt);
    expect(moved.dueDate).toBeNull();
    expect(moved.possibleDate).toBe('2026-09-30');
    expect(moved.dateConfidence).toBe('possible');
    expect(occurrencesBetween(moved, '2026-09-07', '2026-09-13').map((item) => [item.occurrenceDay, item.scheduledAt])).toEqual([
      ['2026-09-07', '2026-09-07T09:30:00'], ['2026-09-09', '2026-09-10T14:00:00'],
    ]);
  });

  it('does not generate occurrences before the series start', () => {
    expect(occurrencesBetween(task, '2026-08-31', '2026-09-06')).toEqual([]);
  });
});
