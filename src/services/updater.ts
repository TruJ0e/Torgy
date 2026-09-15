import { getVersion } from '@tauri-apps/api/app';
import type { Update } from '@tauri-apps/plugin-updater';

export interface AppUpdateStatus {
  supported: boolean;
  available: boolean;
  currentVersion: string;
  version: string | null;
  notes: string | null;
  message: string;
}

let pendingUpdate: Update | null = null;

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  if (!isTauriRuntime()) {
    return { supported: false, available: false, currentVersion: 'development', version: null, notes: null, message: 'Updates are available in the installed desktop app.' };
  }

  const [{ check }, currentVersion] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    getVersion(),
  ]);
  const update = await check({ timeout: 15_000 });
  if (pendingUpdate) await pendingUpdate.close().catch(() => undefined);
  pendingUpdate = update;

  if (!update) {
    return { supported: true, available: false, currentVersion, version: null, notes: null, message: `Torgy ${currentVersion} is up to date.` };
  }

  return {
    supported: true,
    available: true,
    currentVersion: update.currentVersion,
    version: update.version,
    notes: update.body ?? null,
    message: `Torgy ${update.version} is ready to install.`,
  };
}

export async function installAvailableUpdate(onProgress?: (message: string) => void) {
  if (!pendingUpdate) {
    const status = await checkForAppUpdate();
    if (!status.available || !pendingUpdate) throw new Error('No Torgy update is currently available.');
  }

  let downloaded = 0;
  let total: number | null = null;
  onProgress?.(`Downloading Torgy ${pendingUpdate.version}…`);
  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
      return;
    }
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      if (total) onProgress?.(`Downloading update… ${Math.min(100, Math.round((downloaded / total) * 100))}%`);
      return;
    }
    if (event.event === 'Finished') onProgress?.('Download complete. Starting the verified installer…');
  });

  // On Windows Tauri exits this app after launching the updater installer.
  pendingUpdate = null;
}
