import type { AppSnapshot, Student, Task } from '../types';
import { DEFAULT_APPEARANCE_SETTINGS } from '../lib/appearance';

const now = new Date().toISOString();

export const demoStudents: Student[] = [
  { id: 'student-a', displayName: 'Student A', initials: 'SA', canvasUserId: null, syncState: 'synced', pairingState: 'paired', mailboxId: 'mbx-demo-a', peerPublicKey: null, lastSyncAt: now },
  { id: 'student-b', displayName: 'Student B', initials: 'SB', canvasUserId: null, syncState: 'pending', pairingState: 'unpaired', mailboxId: 'mbx-demo-b', peerPublicKey: null, lastSyncAt: null },
];

function task(partial: Partial<Task> & Pick<Task, 'id' | 'studentId' | 'title'>): Task {
  return {
    id: partial.id,
    studentId: partial.studentId,
    course: partial.course ?? null,
    title: partial.title,
    priority: partial.priority ?? 'normal',
    workStatus: partial.workStatus ?? 'todo',
    dueDate: partial.dueDate ?? null,
    possibleDate: partial.possibleDate ?? null,
    scheduledAt: partial.scheduledAt ?? null,
    durationMinutes: partial.durationMinutes ?? null,
    recurringRule: partial.recurringRule ?? null,
    source: partial.source ?? 'advisor',
    sourceRecordId: partial.sourceRecordId ?? null,
    dateConfidence: partial.dateConfidence ?? 'undated',
    notes: partial.notes ?? '',
    originDeviceId: partial.originDeviceId ?? 'demo-device',
    createdByRole: partial.createdByRole ?? 'coordinator',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    version: partial.version ?? 1,
    deletedAt: partial.deletedAt ?? null,
  };
}

export function createInitialSnapshot(): AppSnapshot {
  return {
    schemaVersion: 2,
    deviceId: crypto.randomUUID(),
    students: [],
    tasks: [],
    taskAliases: [],
    duplicateReviews: [],
    syncQueue: [],
    nextSyncSequence: 1,
    sync: { state: 'disabled', lastSyncAt: null, lastAttemptAt: null, message: null, processedEnvelopeIds: [] },
    outlook: {
      state: 'disabled', accountLabel: null, lastDeltaLink: null, deltaRangeStart: null, deltaRangeEnd: null,
      lastSyncAt: null, links: [], message: null,
    },
    settings: {
      firstRunComplete: false,
      role: 'coordinator', coordinatorLabel: 'Academic Coordinator', selectedStudentId: 'all',
      copilotEnabled: false, copilotUrl: '',
      outlookEnabled: false, outlookTenantId: '', outlookClientId: '', outlookAutoSyncSeconds: 60,
      syncEnabled: false, syncTransportMode: 'disabled', syncSharePath: '', syncAutoSeconds: 20,
      academicImportMode: 'manual', canvasBaseUrl: '',
      calendarDayRange: 'standard', calendarDayStartHour: 8, calendarDayEndHour: 19, calendarTimeFormat: '12h',
      ...DEFAULT_APPEARANCE_SETTINGS,
    },
    updatedAt: now,
  };
}

export function createDemoSnapshot(): AppSnapshot {
  const base = createInitialSnapshot();
  return {
    ...base,
    students: demoStudents,
    tasks: [
      task({ id: 'task-1', studentId: 'student-a', course: 'CHEM 101', title: 'Chemistry Test', dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), dateConfidence: 'confirmed', priority: 'high' }),
      task({ id: 'task-2', studentId: 'student-a', course: 'EDU 200', title: 'Puppet Video', possibleDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), dateConfidence: 'possible', source: 'docs' }),
      task({ id: 'task-3', studentId: 'student-b', course: 'ENG 101', title: 'Reading response', dateConfidence: 'undated', source: 'docs' }),
    ],
    settings: { ...base.settings, firstRunComplete: true, role: 'coordinator', selectedStudentId: 'all' },
  };
}
