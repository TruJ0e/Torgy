import { describe, expect, it } from 'vitest';
import { getSyncTransport, portableStudentSyncMessage } from './syncTransport';

describe('sync transport selection', () => {
  it('keeps Windows transports configured', () => {
    expect(getSyncTransport('staff-drive').configured).toBe(true);
    expect(getSyncTransport('managed-agent').configured).toBe(true);
  });

  it('exposes portable student sync without pretending it is configured', async () => {
    const transport = getSyncTransport('portable-student');
    expect(transport.configured).toBe(false);
    expect(portableStudentSyncMessage()).toMatch(/not configured/i);
    await expect(transport.receive({ shareRoot: '', mailboxId: 'm1', direction: 'coordinator-to-student' })).rejects.toThrow(/not configured/i);
  });
});
