import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  excludeRecurringOccurrence,
  moveRecurringOccurrence,
  moveRecurringSeries,
  nextOccurrenceDay,
  occurrencesBetween,
  parseWeeklyRule,
  restoreRecurringOccurrence,
  serializeWeeklyRule,
} from './recurrence';

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
    expect(parseWeeklyRule(rule)).toEqual({ days:[1, 3], moves:{}, dones:[] });
  });

  it('round-trips dones through the rule string', () => {
    const rule = serializeWeeklyRule([2], {}, ['2026-10-13', '2026-10-20']);
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=TU;DONES=2026-10-13,2026-10-20');
    expect(parseWeeklyRule(rule)?.dones).toEqual(['2026-10-13', '2026-10-20']);
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

  it('excluding an occurrence removes it from expansion but keeps the series', () => {
    const excluded = excludeRecurringOccurrence(task, '2026-09-09', new Date('2026-09-08T00:00:00Z'));
    expect(excluded.recurringRule).toContain('DONES=2026-09-09');
    expect(occurrencesBetween(excluded, '2026-09-07', '2026-09-13').map((item) => item.scheduledAt)).toEqual([
      '2026-09-07T09:30:00',
    ]);
    const restored = restoreRecurringOccurrence(excluded, '2026-09-09', new Date('2026-09-08T00:00:00Z'));
    expect(occurrencesBetween(restored, '2026-09-07', '2026-09-13')).toHaveLength(2);
  });

  it('finds the next occurrence day after a completed one', () => {
    expect(nextOccurrenceDay(task, '2026-09-07')).toBe('2026-09-09');
    const excluded = excludeRecurringOccurrence(task, '2026-09-09');
    expect(nextOccurrenceDay(excluded, '2026-09-08')).toBe('2026-09-14');
    expect(nextOccurrenceDay(task, '2026-09-30')).toBe('2026-10-05');
  });

  it('moving the whole series shifts the weekday pattern by the drag delta', () => {
    // Drag the Wed 2026-09-09 instance to Thu 2026-09-10 at 14:00, whole series.
    const moved = moveRecurringSeries(task, '2026-09-09', '2026-09-10T14:00:00', new Date('2026-09-08T00:00:00Z'));
    expect(moved.recurringRule).toBe('FREQ=WEEKLY;BYDAY=TU,TH');
    expect(moved.scheduledAt).toBe('2026-09-08T14:00:00');
    expect(occurrencesBetween(moved, '2026-09-08', '2026-09-17').map((item) => item.scheduledAt)).toEqual([
      '2026-09-08T14:00:00', '2026-09-10T14:00:00', '2026-09-15T14:00:00', '2026-09-17T14:00:00',
    ]);
  });
});
