import type { Priority, Role, Task } from '../types';

/**
 * Schedule/move a task to an ISO datetime (or clear it). Only `scheduledAt` changes —
 * the authoritative `dueDate`, `possibleDate`, and `dateConfidence` are never touched,
 * because scheduling work is separate from when a task is officially due.
 */
export function scheduleTaskAt(task: Task, isoDateTime: string | null, now = new Date()): Task {
  return { ...task, scheduledAt: isoDateTime, version: task.version + 1, updatedAt: now.toISOString() };
}

export interface QuickAddInput {
  title: string;
  studentId: string | null;
  scheduledAt: string;
  durationMinutes: number | null;
  priority: Priority;
  deviceId: string;
  createdByRole: Role;
  recurringRule?: string | null;
}

/**
 * Build a desktop Task from a calendar quick-add. The task is scheduled work only:
 * it gets `scheduledAt` but no authoritative due date, so a quick-add can never
 * fabricate a Confirmed deadline.
 */
export function buildQuickAddTask(input: QuickAddInput, now = new Date()): Task {
  const ts = now.toISOString();
  return {
    id: crypto.randomUUID(),
    studentId: input.studentId,
    course: null,
    title: input.title.trim(),
    priority: input.priority,
    workStatus: 'todo',
    dueDate: null,
    possibleDate: null,
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes,
    recurringRule: input.recurringRule ?? null,
    source: 'advisor',
    sourceRecordId: null,
    dateConfidence: 'undated',
    notes: '',
    originDeviceId: input.deviceId,
    createdByRole: input.createdByRole,
    createdAt: ts,
    updatedAt: ts,
    version: 1,
    deletedAt: null,
  };
}
