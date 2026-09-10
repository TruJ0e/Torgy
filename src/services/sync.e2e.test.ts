import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '../data/mock';
import type { AppSnapshot, Student, Task } from '../types';
import { applySyncEnvelope, createTaskEnvelope, resolveDuplicateReview } from './sync';

const student: Student = {
  id: 'student-a', displayName: 'Student A', initials: 'SA', canvasUserId: null,
  syncState: 'offline', pairingState: 'paired', mailboxId: 'mailbox-a', peerPublicKey: 'peer', lastSyncAt: null,
};

function baseSnapshot(deviceId: string): AppSnapshot {
  const snapshot = createInitialSnapshot();
  return {
    ...snapshot,
    deviceId,
    students: [student],
    settings: { ...snapshot.settings, firstRunComplete: true, syncEnabled: true, syncTransportMode: 'staff-drive' },
  };
}

function task(id: string, role: 'coordinator' | 'student', title: string, dueDate: string | null, possibleDate: string | null): Task {
  return {
    id, studentId: student.id, course: 'CHEM 101', title, priority: 'normal', workStatus: 'todo',
    dueDate, possibleDate, scheduledAt: null, durationMinutes: 45, recurringRule: null, source: role === 'student' ? 'student' : 'advisor',
    sourceRecordId: null, dateConfidence: dueDate ? 'confirmed' : possibleDate ? 'possible' : 'undated', notes: '',
    originDeviceId: `${role}-device`, createdByRole: role, createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:00:00Z', version: 1, deletedAt: null,
  };
}

describe('synthetic coordinator/student end-to-end reconciliation', () => {
  it('converges two independently-created offline copies to one canonical task', () => {
    const coordinatorTask = task('advisor-copy', 'coordinator', 'Chemistry Test', '2026-09-11', null);
    const studentTask = task('student-copy', 'student', 'Chem test', null, '2026-09-11');
    let coordinator = { ...baseSnapshot('advisor-device'), tasks: [coordinatorTask] };
    let studentSide = { ...baseSnapshot('student-device'), tasks: [studentTask] };

    const fromStudent = createTaskEnvelope({ mailboxId: 'mailbox-a', studentId: student.id, deviceId: 'student-device', sequence: 1, operation: 'upsert-task', task: studentTask });
    const receivedAtCoordinator = applySyncEnvelope(coordinator, fromStudent);
    coordinator = receivedAtCoordinator.snapshot;
    expect(receivedAtCoordinator.merged).toBe(true);
    expect(coordinator.tasks.filter((item) => !item.deletedAt)).toHaveLength(1);
    expect(coordinator.tasks[0].id).toBe('advisor-copy');
    expect(coordinator.tasks[0].dueDate).toBe('2026-09-11');
    expect(coordinator.taskAliases).toContainEqual({ aliasId: 'student-copy', canonicalId: 'advisor-copy' });

    const canonical = coordinator.tasks[0];
    const backToStudent = createTaskEnvelope({ mailboxId: 'mailbox-a', studentId: student.id, deviceId: 'advisor-device', sequence: 2, operation: 'upsert-task', task: canonical });
    const receivedAtStudent = applySyncEnvelope(studentSide, backToStudent);
    studentSide = receivedAtStudent.snapshot;
    expect(studentSide.tasks.filter((item) => !item.deletedAt)).toHaveLength(1);
    expect(studentSide.tasks[0].dateConfidence).toBe('confirmed');
  });

  it('is idempotent when the same encrypted transport envelope is delivered twice', () => {
    const incoming = task('task-1', 'student', 'Biology Quiz', '2026-09-12', null);
    const envelope = createTaskEnvelope({ mailboxId: 'mailbox-a', studentId: student.id, deviceId: 'student-device', sequence: 1, operation: 'upsert-task', task: incoming });
    const first = applySyncEnvelope(baseSnapshot('advisor-device'), envelope);
    const second = applySyncEnvelope(first.snapshot, envelope);
    expect(first.received).toBe(true);
    expect(second.received).toBe(false);
    expect(second.snapshot.tasks).toHaveLength(1);
  });

  it('does not silently merge ambiguous offline work', () => {
    const existing = task('test', 'coordinator', 'Chemistry Test', '2026-09-11', null);
    const incoming = task('worksheet', 'student', 'Chemistry worksheet', '2026-09-11', null);
    const snapshot = { ...baseSnapshot('advisor-device'), tasks: [existing] };
    const envelope = createTaskEnvelope({ mailboxId: 'mailbox-a', studentId: student.id, deviceId: 'student-device', sequence: 1, operation: 'upsert-task', task: incoming });
    const result = applySyncEnvelope(snapshot, envelope);
    expect(result.merged).toBe(false);
    expect(result.review || result.snapshot.tasks.length === 2).toBe(true);
  });


  it('resolves an ambiguous duplicate review without losing either decision path', () => {
    const existing = task('canonical', 'coordinator', 'Chemistry Test', '2026-09-11', null);
    const incoming = task('incoming', 'student', 'Chemistry Test Review', '2026-09-11', null);
    const review = {
      id: 'review-1',
      incomingTask: incoming,
      possibleDuplicateId: existing.id,
      score: 0.8,
      createdAt: '2026-09-09T10:05:00Z',
    };
    const snapshot = { ...baseSnapshot('advisor-device'), tasks: [existing], duplicateReviews: [review] };

    const merged = resolveDuplicateReview(snapshot, review.id, 'merge');
    expect(merged.tasks).toHaveLength(1);
    expect(merged.tasks[0].id).toBe(existing.id);
    expect(merged.taskAliases).toContainEqual({ aliasId: incoming.id, canonicalId: existing.id });
    expect(merged.duplicateReviews).toHaveLength(0);

    const separate = resolveDuplicateReview(snapshot, review.id, 'keep-separate');
    expect(separate.tasks.map((item) => item.id).sort()).toEqual(['canonical', 'incoming']);
    expect(separate.duplicateReviews).toHaveLength(0);
  });

  it('does not let an older offline delete erase a newer task version', () => {
    const current = { ...task('task-1', 'coordinator', 'Advising meeting', null, null), version: 4, updatedAt: '2026-09-09T14:00:00Z' };
    const staleDelete = { ...current, version: 2, updatedAt: '2026-09-09T11:00:00Z' };
    const snapshot = { ...baseSnapshot('advisor-device'), tasks: [current] };
    const envelope = createTaskEnvelope({ mailboxId: 'mailbox-a', studentId: student.id, deviceId: 'student-device', sequence: 1, operation: 'delete-task', task: staleDelete });
    const result = applySyncEnvelope(snapshot, envelope);
    expect(result.snapshot.tasks[0].deletedAt).toBeNull();
    expect(result.snapshot.tasks[0].version).toBe(4);
  });
});
