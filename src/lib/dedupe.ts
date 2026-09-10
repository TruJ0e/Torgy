import type { Task } from '../types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'for', 'of', 'on', 'the', 'to', 'with',
  'assignment', 'complete', 'finish', 'submit', 'work',
]);

const normalize = (value: string | null | undefined) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const stem = (word: string) => {
  if (word.length <= 4) return word;
  return word
    .replace(/(ing|ers|ies|ied|ed|es|s)$/i, '')
    .slice(0, 8);
};

export const canonicalWords = (value: string | null | undefined) =>
  normalize(value)
    .split(' ')
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word))
    .map(stem)
    .filter(Boolean);

export const canonicalTitle = (value: string | null | undefined) => canonicalWords(value).join(' ');

const dateOnly = (task: Pick<Task, 'dueDate' | 'possibleDate'>) => task.dueDate ?? task.possibleDate ?? '';

const dayDistance = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return null;
  const aa = Date.parse(`${a}T12:00:00Z`);
  const bb = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(aa) || !Number.isFinite(bb)) return null;
  return Math.round(Math.abs(aa - bb) / 86_400_000);
};

export function taskFingerprint(task: Pick<Task, 'studentId' | 'course' | 'title' | 'dueDate' | 'possibleDate' | 'sourceRecordId'>) {
  if (task.sourceRecordId) return `source:${normalize(task.sourceRecordId)}`;
  return [normalize(task.studentId), normalize(task.course), canonicalTitle(task.title), dateOnly(task)].join('|');
}

const equivalentWord = (a: string, b: string) => {
  if (a === b) return true;
  // Common human shorthand such as "chem" vs "chemistry" should not create
  // duplicate tasks after an offline student/coordinator sync. Requiring four
  // characters avoids treating short unrelated words as equivalent.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 4 && longer.startsWith(shorter);
};

function jaccardWords(a: string, b: string) {
  const aa = [...new Set(canonicalWords(a))];
  const bb = [...new Set(canonicalWords(b))];
  if (!aa.length || !bb.length) return 0;

  const used = new Set<number>();
  let intersection = 0;
  for (const left of aa) {
    const match = bb.findIndex((right, index) => !used.has(index) && equivalentWord(left, right));
    if (match >= 0) {
      used.add(match);
      intersection += 1;
    }
  }
  const union = aa.length + bb.length - intersection;
  return intersection / Math.max(1, union);
}

export interface DuplicateEvidence {
  score: number;
  titleScore: number;
  sameCourse: boolean;
  sameDate: boolean;
  nearbyDate: boolean;
  sameSourceId: boolean;
}

export function duplicateEvidence(a: Task, b: Task): DuplicateEvidence {
  if (a.id === b.id) {
    return { score: 1, titleScore: 1, sameCourse: true, sameDate: true, nearbyDate: false, sameSourceId: false };
  }

  const sameSourceId = Boolean(a.sourceRecordId && b.sourceRecordId && a.sourceRecordId === b.sourceRecordId);
  if (sameSourceId) {
    return { score: 1, titleScore: 1, sameCourse: true, sameDate: true, nearbyDate: false, sameSourceId: true };
  }

  if (a.studentId !== b.studentId) {
    return { score: 0, titleScore: 0, sameCourse: false, sameDate: false, nearbyDate: false, sameSourceId: false };
  }

  const titleScore = jaccardWords(a.title, b.title);
  const normalizedCourseA = normalize(a.course);
  const normalizedCourseB = normalize(b.course);
  const sameCourse = Boolean(normalizedCourseA && normalizedCourseA === normalizedCourseB);
  const distance = dayDistance(dateOnly(a), dateOnly(b));
  const sameDate = distance === 0 && Boolean(dateOnly(a) && dateOnly(b));
  const nearbyDate = distance !== null && distance > 0 && distance <= 1;

  let score = titleScore * 0.62;
  if (sameCourse) score += 0.14;
  if (sameDate) score += 0.24;
  else if (nearbyDate && titleScore >= 0.75) score += 0.08;

  // No date on one side is common during offline entry. Do not punish it, but do not
  // automatically merge unless the title/course match is exceptionally strong.
  const oneDateMissing = Boolean(dateOnly(a)) !== Boolean(dateOnly(b));
  if (oneDateMissing && sameCourse && titleScore >= 0.9) score += 0.04;

  return {
    score: Math.min(score, 0.99),
    titleScore,
    sameCourse,
    sameDate,
    nearbyDate,
    sameSourceId,
  };
}

export function duplicateScore(a: Task, b: Task): number {
  return duplicateEvidence(a, b).score;
}

export function findPossibleDuplicate(candidate: Task, existing: Task[]) {
  return existing
    .filter((task) => !task.deletedAt)
    .map((task) => ({ task, evidence: duplicateEvidence(candidate, task) }))
    .filter((x) => x.evidence.score >= 0.72)
    .sort((a, b) => b.evidence.score - a.evidence.score)[0] ?? null;
}

export function shouldAutoMerge(a: Task, b: Task) {
  const evidence = duplicateEvidence(a, b);
  if (evidence.sameSourceId) return true;
  return evidence.score >= 0.93 && evidence.titleScore >= 0.86 && (evidence.sameDate || (!dateOnly(a) && !dateOnly(b)));
}

export function mergeDuplicateTasks(a: Task, b: Task, canonicalId: string = a.id): Task {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const older = newer === a ? b : a;
  const confirmed = a.dateConfidence === 'confirmed' ? a : b.dateConfidence === 'confirmed' ? b : null;
  const possible = !confirmed
    ? (a.dateConfidence === 'possible' ? a : b.dateConfidence === 'possible' ? b : null)
    : null;

  const notes = [a.notes, b.notes].map((x) => x.trim()).filter(Boolean);

  return {
    ...older,
    ...newer,
    id: canonicalId,
    dueDate: confirmed?.dueDate ?? null,
    possibleDate: confirmed ? null : possible?.possibleDate ?? null,
    dateConfidence: confirmed ? 'confirmed' : possible ? 'possible' : 'undated',
    sourceRecordId: a.sourceRecordId ?? b.sourceRecordId,
    notes: [...new Set(notes)].join('\n'),
    version: Math.max(a.version, b.version) + 1,
    updatedAt: new Date(Math.max(Date.parse(a.updatedAt), Date.parse(b.updatedAt))).toISOString(),
    deletedAt: null,
  };
}
