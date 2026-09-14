import { describe, expect, it } from 'vitest';
import { checkForAppUpdate } from './updater';

describe('updater service', () => {
  it('stays inert outside the installed Tauri runtime', async () => {
    const status = await checkForAppUpdate();
    expect(status).toEqual({
      supported: false,
      available: false,
      currentVersion: 'development',
      version: null,
      notes: null,
      message: 'Updates are available in the installed desktop app.',
    });
  });
});
