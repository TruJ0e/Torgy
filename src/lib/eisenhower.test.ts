import { describe, expect, it } from 'vitest';
import { eisenhowerQuadrant } from './eisenhower';
import type { InfoDumpItem } from '../types';

function item(patch: Partial<InfoDumpItem> = {}): InfoDumpItem {
  return {
    title: 'Test',
    studentId: null,
    course: null,
    dueDate: null,
    possibleDate: null,
    time: null,
    durationMinutes: null,
    priority: 'normal',
    notes: '',
    uncertain: false,
    ...patch,
  };
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('eisenhowerQuadrant', () => {
  it('Q1: dueDate within 2 days', () => {
    expect(eisenhowerQuadrant(item({ dueDate: isoDaysFromNow(0) }))).toBe('q1');
    expect(eisenhowerQuadrant(item({ dueDate: isoDaysFromNow(1) }))).toBe('q1');
    expect(eisenhowerQuadrant(item({ dueDate: isoDaysFromNow(2) }))).toBe('q1');
  });

  it('Q1: high priority with date within 7 days', () => {
    expect(eisenhowerQuadrant(item({ priority: 'high', possibleDate: isoDaysFromNow(5) }))).toBe('q1');
    expect(eisenhowerQuadrant(item({ priority: 'high', dueDate: isoDaysFromNow(7) }))).toBe('q1');
  });

  it('Q1: overdue dueDate', () => {
    expect(eisenhowerQuadrant(item({ dueDate: isoDaysFromNow(-1) }))).toBe('q1');
  });

  it('Q2: dueDate beyond 2 days', () => {
    expect(eisenhowerQuadrant(item({ dueDate: isoDaysFromNow(3) }))).toBe('q2');
    expect(eisenhowerQuadrant(item({ dueDate: isoDaysFromNow(30) }))).toBe('q2');
  });

  it('Q2: high priority with no imminent date', () => {
    expect(eisenhowerQuadrant(item({ priority: 'high' }))).toBe('q2');
    expect(eisenhowerQuadrant(item({ priority: 'high', dueDate: isoDaysFromNow(10) }))).toBe('q2');
  });

  it('Q2: course with future date', () => {
    expect(eisenhowerQuadrant(item({ course: 'ENG 101', possibleDate: isoDaysFromNow(5) }))).toBe('q2');
  });

  it('Q3: possibleDate within 3 days (not high priority)', () => {
    expect(eisenhowerQuadrant(item({ possibleDate: isoDaysFromNow(1) }))).toBe('q3');
    expect(eisenhowerQuadrant(item({ possibleDate: isoDaysFromNow(3) }))).toBe('q3');
  });

  it('Q3: low priority with imminent date', () => {
    expect(eisenhowerQuadrant(item({ priority: 'low', possibleDate: isoDaysFromNow(5) }))).toBe('q3');
  });

  it('Q3: uncertain with date within 3 days', () => {
    expect(eisenhowerQuadrant(item({ uncertain: true, possibleDate: isoDaysFromNow(2) }))).toBe('q3');
  });

  it('Q3: possibleDate does not override high priority Q1', () => {
    // high + possibleDate within 7 → Q1, not Q3
    expect(eisenhowerQuadrant(item({ priority: 'high', possibleDate: isoDaysFromNow(2) }))).toBe('q1');
  });

  it('Q4: no date at all', () => {
    expect(eisenhowerQuadrant(item())).toBe('q4');
    expect(eisenhowerQuadrant(item({ priority: 'low' }))).toBe('q4');
  });

  it('Q4: normal priority with distant possibleDate and no course', () => {
    expect(eisenhowerQuadrant(item({ possibleDate: isoDaysFromNow(30) }))).toBe('q4');
  });
});
