import type { AppSettings, RuntimeInfo, SyncTransportMode } from '../types';

export type TorgyPlatform = 'windows' | 'macos' | 'ios' | 'browser-development' | 'other';

export interface PlatformCapabilities {
  platform: TorgyPlatform;
  appMode: RuntimeInfo['appMode'];
  secureStorage: boolean;
  supportsCoordinator: boolean;
  supportsStudent: boolean;
  supportsManagedAgent: boolean;
  supportsPortableSync: boolean;
  portableSyncConfigured: boolean;
}

export function normalizePlatform(platform: string): TorgyPlatform {
  const value = platform.toLowerCase();
  if (value === 'windows') return 'windows';
  if (value === 'macos' || value === 'darwin') return 'macos';
  if (value === 'ios') return 'ios';
  if (value === 'browser-development') return 'browser-development';
  return 'other';
}

export function platformCapabilities(runtime: RuntimeInfo): PlatformCapabilities {
  return {
    platform: normalizePlatform(runtime.platform),
    appMode: runtime.appMode,
    secureStorage: runtime.secureStorage,
    supportsCoordinator: runtime.supportsCoordinator,
    supportsStudent: runtime.supportsStudent,
    supportsManagedAgent: runtime.supportsManagedAgent,
    supportsPortableSync: runtime.supportsPortableSync,
    portableSyncConfigured: runtime.portableSyncConfigured,
  };
}
export function preferredStudentTransport(capabilities: PlatformCapabilities): SyncTransportMode {
  if (capabilities.supportsManagedAgent) return 'managed-agent';
  if (capabilities.supportsPortableSync) return 'portable-student';
  return 'disabled';
}

export function constrainSettingsToPlatform(settings: AppSettings, capabilities: PlatformCapabilities): AppSettings {
  if (capabilities.supportsCoordinator) return settings;
  const syncTransportMode = settings.syncEnabled ? preferredStudentTransport(capabilities) : 'disabled';
  return {
    ...settings,
    role: 'student',
    syncTransportMode,
    syncSharePath: capabilities.supportsManagedAgent ? settings.syncSharePath : '',
  };
}
