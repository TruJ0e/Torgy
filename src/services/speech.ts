function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface SpeechResult {
  text: string;
  confidence: number | null;
  engine: string;
}

export async function dictateOnce(): Promise<SpeechResult> {
  if (!isTauriRuntime()) {
    throw new Error('Local dictation is available only in the installed desktop build.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<SpeechResult>('speech_dictate_once');
}
