import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { NativeCopilotInfoDumpService } from './copilot';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const bridge = vi.mocked(invoke);
const service = new NativeCopilotInfoDumpService('https://copilot.microsoft.com');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, setTimeout });
  bridge.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('embedded Copilot organize', () => {
  it('waits for the window and returns its normalized response without sidecar or GPT calls', async () => {
    let probes = 0;
    let reads = 0;
    bridge.mockImplementation(async (command) => {
      switch (command) {
        case 'open_copilot_window': return undefined;
        case 'copilot_probe': return { editables: ++probes > 1 ? [{}] : [] };
        case 'copilot_submit_prompt': return { ok: true };
        case 'copilot_read_latest_response':
          return { response: ++reads === 1 ? 'Previous reply' : '{"items":[{"title":"Read chapter 3","studentName":"Alex","priority":"high","durationMinutes":30}]}' };
        default: throw new Error(`Unexpected command: ${command}`);
      }
    });
    const result = service.organize('Alex needs to read chapter 3 for 30 minutes.', {
      students: [{ id: 'alex', displayName: 'Alex' }],
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({
      provider: 'copilot',
      items: [{ title: 'Read chapter 3', studentId: 'alex', priority: 'high', durationMinutes: 30 }],
    });
    expect(bridge.mock.calls.map(([command]) => command)).toEqual([
      'open_copilot_window', 'copilot_probe', 'copilot_probe',
      'copilot_read_latest_response', 'copilot_submit_prompt',
      'copilot_read_latest_response', 'copilot_read_latest_response', 'copilot_read_latest_response',
    ]);
    expect(bridge).toHaveBeenCalledWith('copilot_submit_prompt', {
      prompt: expect.stringContaining('Alex needs to read chapter 3 for 30 minutes.'),
    });
  });

  it('asks for in-window sign-in when navigation never reaches a composer', async () => {
    bridge.mockImplementation(async (command) => {
      if (command === 'open_copilot_window') return undefined;
      if (command === 'copilot_probe') throw new Error('Outside the approved bridge boundary');
      throw new Error(`Unexpected command: ${command}`);
    });
    const result = expect(service.organize('Read chapter 3')).rejects.toThrow(/signing in.*inside the Copilot window/);
    await vi.runAllTimersAsync();
    await result;
    expect(bridge.mock.calls.every(([command]) => ['open_copilot_window', 'copilot_probe'].includes(command))).toBe(true);
  });

  it('surfaces a window submission failure without falling back to another provider', async () => {
    bridge.mockImplementation(async (command) => {
      if (command === 'open_copilot_window') return undefined;
      if (command === 'copilot_probe') return { editables: [{}] };
      if (command === 'copilot_read_latest_response') return { response: '' };
      if (command === 'copilot_submit_prompt') return { ok: false, error: 'No visible Send button' };
      throw new Error(`Unexpected command: ${command}`);
    });
    await expect(service.organize('Read chapter 3')).rejects.toThrow(/No visible Send button.*Sign in to the Copilot window/);
    expect(bridge.mock.calls.map(([command]) => command)).toEqual([
      'open_copilot_window', 'copilot_probe', 'copilot_read_latest_response', 'copilot_submit_prompt',
    ]);
  });

  it('requires the approved URL before invoking any bridge', async () => {
    await expect(new NativeCopilotInfoDumpService('').organize('Read chapter 3')).rejects.toThrow(/URL in Settings/);
    expect(bridge).not.toHaveBeenCalled();
  });
});
