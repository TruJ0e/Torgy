import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '../data/mock';
import { runReadinessCheck } from './readiness';

describe('readiness report', () => {
  it('identifies deployment blockers without requiring live credentials', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.settings.firstRunComplete = true;
    const report = await runReadinessCheck(snapshot, {
      platform: 'windows',
      storage: 'Windows DPAPI protected local file',
      appDataDir: 'C:\\Users\\demo\\AppData\\Roaming\\Torgy',
      appMode: 'advisor',
      supportsCoordinator: true,
      supportsStudent: true,
      supportsManagedAgent: true,
      supportsPortableSync: false,
      portableSyncConfigured: false,
      secureStorage: true,
      managedAgentInstalled: false,
      managedAgentConfigured: false,
    legacyPerMachineInstall: false,
    });
    expect(report.checks.find((item) => item.key === 'local-storage')?.status).toBe('ready');
    expect(report.checks.find((item) => item.key === 'outlook')?.status).toBe('blocked');
    expect(report.checks.find((item) => item.key === 'sync')?.status).toBe('blocked');
    expect(report.ready).toBe(false);
  });
});
