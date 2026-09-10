import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '../data/mock';
import { migrateSnapshot, parseBackupJson } from './persistence';

describe('backup migration and restore', () => {
  it('round-trips the current schema', () => {
    const source = createInitialSnapshot();
    const restored = parseBackupJson(JSON.stringify(source));
    expect(restored.schemaVersion).toBe(2);
    expect(restored.deviceId).toBe(source.deviceId);
    expect(restored.tasks).toEqual([]);
  });

  it('migrates the original v1 shape without introducing credentials', () => {
    const restored = migrateSnapshot({
      schemaVersion: 1,
      deviceId: 'old-device',
      students: [{ id: 's1', displayName: 'Student', initials: 'S', mailboxId: null }],
      tasks: [],
      syncQueue: [],
      nextSyncSequence: 1,
      settings: { role: 'coordinator' },
      updatedAt: '2026-09-09T00:00:00Z',
    });
    expect(restored?.schemaVersion).toBe(2);
    expect(restored?.students[0].canvasUserId).toBeNull();
    expect(restored?.students[0].pairingState).toBe('unpaired');
    expect((restored?.settings as unknown as Record<string, unknown>).canvasToken).toBeUndefined();
  });

  it('rejects unrelated JSON', () => {
    expect(() => parseBackupJson('{"hello":"world"}')).toThrow(/supported Torgy backup/i);
  });
});
