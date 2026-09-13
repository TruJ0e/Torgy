import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '../data/mock';
import type { RuntimeInfo } from '../types';
import { constrainSettingsToPlatform, platformCapabilities, preferredStudentTransport } from './capabilities';

function runtime(overrides: Partial<RuntimeInfo> = {}): RuntimeInfo {
  return {
    platform: 'windows',
    storage: 'Windows DPAPI current-user encrypted files',
    appDataDir: 'C:\\Torgy',
    appMode: 'advisor',
    supportsCoordinator: true,
    supportsStudent: true,
    supportsManagedAgent: true,
    supportsPortableSync: false,
    portableSyncConfigured: false,
    secureStorage: true,
    managedAgentInstalled: false,
    managedAgentConfigured: false,
    ...overrides,
  };
}

describe('platform capabilities', () => {
  it('preserves coordinator settings on Windows', () => {
    const settings = createInitialSnapshot().settings;
    const capabilities = platformCapabilities(runtime());
    expect(constrainSettingsToPlatform(settings, capabilities)).toBe(settings);
    expect(preferredStudentTransport(capabilities)).toBe('managed-agent');
  });
  it('locks Apple builds to student mode and the portable transport slot', () => {
    const settings = { ...createInitialSnapshot().settings, role: 'coordinator' as const, syncEnabled: true, syncTransportMode: 'staff-drive' as const, syncSharePath: '\\\\staff\\torgy' };
    const capabilities = platformCapabilities(runtime({
      platform: 'macos',
      appMode: 'student',
      supportsCoordinator: false,
      supportsManagedAgent: false,
      supportsPortableSync: true,
      secureStorage: true,
    }));
    const constrained = constrainSettingsToPlatform(settings, capabilities);
    expect(constrained.role).toBe('student');
    expect(constrained.syncTransportMode).toBe('portable-student');
    expect(constrained.syncSharePath).toBe('');
    expect(preferredStudentTransport(capabilities)).toBe('portable-student');
  });
});
