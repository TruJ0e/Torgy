import { invoke } from '@tauri-apps/api/core';
import { createInitialSnapshot } from '../data/mock';
import { normalizeAppearanceSettings } from '../lib/appearance';
import type { AppSnapshot, DeploymentDefaults, RuntimeInfo } from '../types';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const DEV_KEY = 'torgy-development-state-v2';

export function migrateSnapshot(value: unknown): AppSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const base = createInitialSnapshot();
  if (raw.schemaVersion === 2) {
    const candidate = raw as unknown as AppSnapshot;
    return {
      ...base,
      ...candidate,
      taskAliases: Array.isArray(candidate.taskAliases) ? candidate.taskAliases : [],
      duplicateReviews: Array.isArray(candidate.duplicateReviews) ? candidate.duplicateReviews : [],
      sync: { ...base.sync, ...(candidate.sync ?? {}) },
      outlook: { ...base.outlook, ...(candidate.outlook ?? {}) },
      settings: { ...base.settings, ...(candidate.settings ?? {}), ...normalizeAppearanceSettings(candidate.settings) },
      students: (candidate.students ?? []).map((student) => ({
        ...student,
        canvasUserId: student.canvasUserId ?? null,
        pairingState: student.pairingState ?? (student.peerPublicKey ? 'paired' : 'unpaired'),
        peerPublicKey: student.peerPublicKey ?? null,
      })),
    };
  }

  // v1 migration from the first prototype. No secret values are introduced.
  if (raw.schemaVersion === 1) {
    const old = raw as Record<string, any>;
    return {
      ...base,
      deviceId: typeof old.deviceId === 'string' ? old.deviceId : base.deviceId,
      students: Array.isArray(old.students) ? old.students.map((student: any) => ({
        id: String(student.id ?? crypto.randomUUID()),
        displayName: String(student.displayName ?? 'Student'),
        initials: String(student.initials ?? 'S'),
        canvasUserId: null,
        syncState: student.syncState ?? 'offline',
        pairingState: 'unpaired',
        mailboxId: student.mailboxId ?? null,
        peerPublicKey: null,
        lastSyncAt: student.lastSyncAt ?? null,
      })) : [],
      tasks: Array.isArray(old.tasks) ? old.tasks : [],
      syncQueue: Array.isArray(old.syncQueue) ? old.syncQueue : [],
      nextSyncSequence: Number(old.nextSyncSequence ?? 1),
      outlook: { ...base.outlook, ...(old.outlook ?? {}) },
      settings: { ...base.settings, ...(old.settings ?? {}), ...normalizeAppearanceSettings(old.settings), firstRunComplete: true },
      updatedAt: typeof old.updatedAt === 'string' ? old.updatedAt : new Date().toISOString(),
    };
  }
  return null;
}

export async function loadLocalSnapshot(): Promise<AppSnapshot | null> {
  if (isTauriRuntime()) {
    const raw = await invoke<unknown | null>('load_snapshot');
    return migrateSnapshot(raw);
  }
  try {
    const raw = localStorage.getItem(DEV_KEY);
    return raw ? migrateSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveLocalSnapshot(snapshot: AppSnapshot) {
  if (isTauriRuntime()) {
    await invoke('save_snapshot', { snapshot });
    return;
  }
  localStorage.setItem(DEV_KEY, JSON.stringify(snapshot));
}

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  if (isTauriRuntime()) return invoke<RuntimeInfo>('runtime_info');
  return {
    platform: 'browser-development', storage: 'browser localStorage (development only)', appDataDir: '',
    appMode: 'development', supportsCoordinator: true, supportsStudent: true,
    supportsManagedAgent: false, supportsPortableSync: false, portableSyncConfigured: false,
    secureStorage: false, managedAgentInstalled: false, managedAgentConfigured: false,
  };
}

export async function getDeploymentDefaults(): Promise<DeploymentDefaults> {
  if (isTauriRuntime()) return invoke<DeploymentDefaults>('deployment_defaults');
  return { copilotUrl: '', outlookTenantId: '', outlookClientId: '', syncSharePath: '', canvasBaseUrl: '' };
}

export async function exportBackupJson(snapshot: AppSnapshot): Promise<string> {
  if (isTauriRuntime()) return invoke<string>('export_backup_json', { snapshot });
  return JSON.stringify(snapshot, null, 2);
}


export function parseBackupJson(text: string): AppSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }
  const migrated = migrateSnapshot(parsed);
  if (!migrated) throw new Error('This file is not a supported Torgy backup.');
  return migrated;
}

export async function parseBackupFile(file: File): Promise<AppSnapshot> {
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Torgy backups must be JSON files.');
  return parseBackupJson(await file.text());
}
