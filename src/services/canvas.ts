import { invoke } from '@tauri-apps/api/core';
import type { AppSnapshot, CanvasAssignmentRecord, DuplicateReview, Task, TaskAlias } from '../types';
import { reconcileIncoming } from './sync';


function addAlias(aliases: TaskAlias[], aliasId: string, canonicalId: string) {
  if (!aliasId || aliasId === canonicalId) return aliases;
  return [...aliases.filter((alias) => alias.aliasId !== aliasId), { aliasId, canonicalId }];
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function connectCanvas(baseUrl: string, token: string) {
  if (!isTauriRuntime()) throw new Error('Canvas connection is available only in the installed desktop app.');
  if (!baseUrl.trim() || !token.trim()) throw new Error('Canvas URL and token are required.');
  return invoke<{ accountLabel: string }>('canvas_connect', { baseUrl, token });
}

export async function disconnectCanvas() {
  if (isTauriRuntime()) await invoke('canvas_disconnect');
}

export async function canvasStatus() {
  if (!isTauriRuntime()) return { connected: false, accountLabel: null as string | null, baseUrl: null as string | null };
  return invoke<{ connected: boolean; accountLabel: string | null; baseUrl: string | null }>('canvas_status');
}

export async function syncCanvasAssignments(snapshot: AppSnapshot) {
  if (!isTauriRuntime()) throw new Error('Canvas synchronization requires the installed desktop app.');
  const students = snapshot.students.filter((student) => student.canvasUserId?.trim()).map((student) => ({
    studentId: student.id,
    canvasUserId: student.canvasUserId!,
  }));
  if (!students.length) throw new Error('Add a Canvas user ID to at least one student first.');
  const records = await invoke<CanvasAssignmentRecord[]>('canvas_fetch_assignments', { students });
  let tasks = [...snapshot.tasks];
  let taskAliases = [...snapshot.taskAliases];
  let duplicateReviews = [...snapshot.duplicateReviews];
  let inserted = 0;
  let updated = 0;
  let reviews = 0;
  const now = new Date().toISOString();

  for (const record of records) {
    const incoming: Task = {
      id: crypto.randomUUID(),
      studentId: record.studentId,
      course: record.courseName,
      title: record.assignmentName,
      priority: 'normal',
      workStatus: 'todo',
      dueDate: record.officialDueDate,
      possibleDate: record.officialDueDate ? null : record.possibleDueDate,
      scheduledAt: null,
      durationMinutes: null,
      recurringRule: null,
      source: 'canvas',
      sourceRecordId: `canvas:${record.studentCanvasId}:${record.courseId}:${record.assignmentId}`,
      dateConfidence: record.officialDueDate ? 'confirmed' : record.possibleDueDate ? 'possible' : 'undated',
      notes: [record.canvasUrl ? `Canvas: ${record.canvasUrl}` : '', record.detectedDateSource ? `Possible date detected from ${record.detectedDateSource}; human confirmation required.` : ''].filter(Boolean).join('\n'),
      originDeviceId: snapshot.deviceId,
      createdByRole: snapshot.settings.role,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
    };
    const result = reconcileIncoming(incoming, tasks.filter((task) => !task.deletedAt), snapshot.taskAliases);
    if (result.action === 'insert') { tasks = [result.task, ...tasks]; inserted += 1; }
    else if (result.action === 'update') { tasks = tasks.map((task) => task.id === result.task.id ? result.task : task); updated += 1; }
    else if (result.action === 'merge') {
      tasks = tasks.map((task) => task.id === result.duplicateOf ? result.task : task);
      taskAliases = addAlias(taskAliases, incoming.id, result.duplicateOf);
      updated += 1;
    }
    else if (result.action === 'review') {
      const duplicate: DuplicateReview = { id: crypto.randomUUID(), incomingTask: result.task, possibleDuplicateId: result.possibleDuplicateId, score: result.score, createdAt: now };
      duplicateReviews = [duplicate, ...duplicateReviews];
      reviews += 1;
    }
  }

  return { snapshot: { ...snapshot, tasks, taskAliases, duplicateReviews, updatedAt: now }, inserted, updated, reviews, fetched: records.length };
}
