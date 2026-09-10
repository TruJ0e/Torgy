import type { InfoDumpResult } from '../types';

export interface InfoDumpStudentContext {
  id: string;
  displayName: string;
}

export interface InfoDumpContext {
  /** Selected local student. When present, Copilot cannot redirect the item to another student. */
  studentId?: string | null;
  /** Local roster used only to map a spoken name to a local ID. IDs are never sent to Copilot. */
  students?: InfoDumpStudentContext[];
}

export interface InfoDumpService {
  organize(rawText: string, context?: InfoDumpContext): Promise<InfoDumpResult>;
}

/**
 * Development-only deterministic fallback. It does not pretend to be AI.
 * The production desktop build replaces this behind the same interface with the
 * university-approved Copilot bridge after its WebView/browser DOM is validated.
 */
export class DevelopmentInfoDumpService implements InfoDumpService {
  async organize(rawText: string, context?: InfoDumpContext): Promise<InfoDumpResult> {
    const cleaned = rawText.trim().replace(/\s+/g, ' ');
    const fragments = cleaned
      .split(/(?:\.|\n|;|\band then\b|\balso\b)/i)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 6);

    return {
      provider: 'development-fallback',
      rawText,
      items: fragments.map((fragment) => ({
        title: fragment.charAt(0).toUpperCase() + fragment.slice(1),
        studentId: context?.studentId ?? null,
        course: null,
        dueDate: null,
        possibleDate: null,
        time: null,
        durationMinutes: null,
        priority: 'normal',
        notes: 'Development fallback only. Review before adding.',
        uncertain: true,
      })),
    };
  }
}

export const COPILOT_SYSTEM_PROMPT = `You are the language organizer for Torgy, an academic-support desktop application.

Your job is to transform noisy or rambling speech transcription into short, actionable academic-support items.
- Correct likely speech-recognition errors, misspellings, repetitions, filler words, and fragmented speech.
- Preserve the speaker's intended meaning.
- Use the CURRENT LOCAL DATE supplied by Torgy to resolve relative expressions such as "Friday", "tomorrow", and "next week".
- Do not invent names, classes, dates, times, durations, priorities, or facts that were not stated or strongly implied.
- When Torgy supplies an ALLOWED STUDENT NAMES list, studentName must be either one exact name from that list or null. Use the list to correct likely speech-recognition spelling errors in names.
- If a date is uncertain, put it in possibleDate and leave dueDate null.
- dueDate is reserved for an explicit, unambiguous date stated by the speaker. Torgy will still require human confirmation before treating an AI-derived date as authoritative.
- Dates must be ISO calendar dates in YYYY-MM-DD format or null.
- Times must be local 24-hour HH:MM format or null.
- durationMinutes must be a whole number from 5 through 480 or null.
- Keep titles short and useful.
- Put relevant context that should not be lost into notes.
- If one rambling statement contains several actionable items, split it into several items.
- Never include commentary before or after the JSON.

Return JSON only in this exact outer shape:
{
  "items": [
    {
      "title": "",
      "studentName": null,
      "course": null,
      "dueDate": null,
      "possibleDate": null,
      "time": null,
      "durationMinutes": null,
      "priority": "normal",
      "notes": "",
      "uncertain": true
    }
  ]
}`;
