import { describe, expect, it } from 'vitest';
import { waitForCompletedResponse } from './gpt';

const noWait = async () => {};

function reader(results: Record<string, unknown>[]) {
  let index = 0;
  return async () => results[Math.min(index++, results.length - 1)];
}

describe('waitForCompletedResponse', () => {
  it('does not return a streamed reply that pauses before completion', async () => {
    const read = reader([
      { response: '{"items":[{"title":"Math', assistantCount: 1, generating: true, complete: false },
      // Stream stalls: same partial text twice, still generating.
      { response: '{"items":[{"title":"Math', assistantCount: 1, generating: true, complete: false },
      { response: '{"items":[{"title":"Math', assistantCount: 1, generating: true, complete: false },
      { response: '{"items":[{"title":"Math homework"}]}', assistantCount: 1, generating: false, complete: true },
      { response: '{"items":[{"title":"Math homework"}]}', assistantCount: 1, generating: false, complete: true },
    ]);
    await expect(waitForCompletedResponse('', 0, read, noWait)).resolves.toBe('{"items":[{"title":"Math homework"}]}');
  });

  it('ignores the previous reply until a new assistant turn appears', async () => {
    const read = reader([
      { response: 'old answer', assistantCount: 1, generating: false, complete: true },
      { response: 'old answer', assistantCount: 1, generating: false, complete: true },
      { response: '{"items":[]}', assistantCount: 2, generating: false, complete: true },
      { response: '{"items":[]}', assistantCount: 2, generating: false, complete: true },
    ]);
    await expect(waitForCompletedResponse('old answer', 1, read, noWait)).resolves.toBe('{"items":[]}');
  });

  it('reports a still-generating reply on timeout instead of returning partial text', async () => {
    const read = reader([{ response: '{"items":[', assistantCount: 1, generating: true, complete: false }]);
    await expect(waitForCompletedResponse('', 0, read, noWait, 5_000)).rejects.toThrow(/still writing/);
  });
});
