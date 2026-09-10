import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '../data/mock';
import { detectPossibleDateFromText, importAcademicRecords, parseAcademicText } from './academicImport';

describe('academic import safety', () => {
  it('detects a date embedded in an assignment title as possible, never official', () => {
    const rows = parseAcademicText('Student\tCourse\tAssignment\nStudent A\tART 101\tPuppet and Worksheet Sept 16, 2026', 'export.tsv');
    expect(rows[0].officialDueDate).toBeNull();
    expect(rows[0].possibleDueDate).toBe('2026-09-16');
  });

  it('keeps an explicitly confirmed date authoritative', () => {
    const rows = parseAcademicText('Student,Course,Assignment,Due Date,Date Status\nStudent A,CHEM 101,Test,2026-09-11,confirmed', 'export.csv', 'text/csv');
    expect(rows[0].officialDueDate).toBe('2026-09-11');
    expect(rows[0].possibleDueDate).toBeNull();
  });

  it('rejects impossible calendar dates', () => {
    expect(detectPossibleDateFromText('Due February 31, 2026')).toBeNull();
  });

  it('imports inferred dates as possible tasks only', () => {
    const snapshot = createInitialSnapshot();
    snapshot.students = [{ id: 's1', displayName: 'Student A', initials: 'SA', canvasUserId: null, syncState: 'offline', pairingState: 'unpaired', mailboxId: null, peerPublicKey: null, lastSyncAt: null }];
    snapshot.settings.selectedStudentId = 's1';
    const result = importAcademicRecords(snapshot, [{ studentId: 's1', studentName: 'Student A', course: 'ART 101', title: 'Puppet Sept 16, 2026', officialDueDate: null, possibleDueDate: '2026-09-16', sourceRecordId: null, notes: '' }]);
    expect(result.snapshot.tasks[0].dueDate).toBeNull();
    expect(result.snapshot.tasks[0].possibleDate).toBe('2026-09-16');
    expect(result.snapshot.tasks[0].dateConfidence).toBe('possible');
  });

  it('queues an ambiguous academic duplicate for human review instead of dropping it', () => {
    const snapshot = createInitialSnapshot();
    snapshot.students = [{ id: 's1', displayName: 'Student A', initials: 'SA', canvasUserId: null, syncState: 'offline', pairingState: 'unpaired', mailboxId: null, peerPublicKey: null, lastSyncAt: null }];
    snapshot.settings.selectedStudentId = 's1';
    const first = importAcademicRecords(snapshot, [{ studentId: 's1', studentName: 'Student A', course: 'CHEM 101', title: 'Chemistry Test', officialDueDate: '2026-09-11', possibleDueDate: null, sourceRecordId: null, notes: '' }]);
    const second = importAcademicRecords(first.snapshot, [{ studentId: 's1', studentName: 'Student A', course: 'CHEM 101', title: 'Chemistry Test Review', officialDueDate: '2026-09-11', possibleDueDate: null, sourceRecordId: null, notes: '' }]);
    expect(second.review).toBe(1);
    expect(second.snapshot.tasks).toHaveLength(1);
    expect(second.snapshot.duplicateReviews).toHaveLength(1);
    expect(second.snapshot.duplicateReviews[0].incomingTask.title).toBe('Chemistry Test Review');
  });
});
