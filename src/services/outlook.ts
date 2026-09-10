import { invoke } from '@tauri-apps/api/core';
import type { AppSnapshot, OutlookLink, OutlookSyncState, Task } from '../types';

interface OutlookAccountResult {
  accountLabel: string;
}

interface GraphEvent {
  id: string;
  changeKey?: string | null;
  subject?: string | null;
  categories?: string[] | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  isCancelled?: boolean;
  ['@removed']?: { reason?: string };
}

interface DeltaResult {
  events: GraphEvent[];
  deltaLink: string;
}

interface UpsertResult {
  id: string;
  changeKey: string | null;
}

interface TorgyEventMarkers {
  taskId: string | null;
  studentId: string | null;
  taskVersion: number | null;
}

function parseTorgyMarkers(event: GraphEvent): TorgyEventMarkers {
  const content = event.body?.content ?? '';
  const value = (name: string) => content.match(new RegExp(`(?:^|\\n)${name}:\\s*([^\\r\\n<]+)`, 'i'))?.[1]?.trim() ?? null;
  const taskIdRaw = value('Torgy-Task-ID');
  const studentIdRaw = value('Torgy-Student-ID');
  const versionRaw = value('Torgy-Task-Version');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const version = versionRaw ? Number.parseInt(versionRaw, 10) : NaN;
  return {
    taskId: taskIdRaw && uuid.test(taskIdRaw) ? taskIdRaw : null,
    studentId: studentIdRaw || null,
    taskVersion: Number.isFinite(version) && version >= 0 ? version : null,
  };
}

export interface OutlookSyncResult {
  snapshot: AppSnapshot;
  pulled: number;
  pushed: number;
  deleted: number;
  message: string;
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function windowRange() {
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const end = new Date();
  end.setDate(end.getDate() + 365);
  return { start: start.toISOString(), end: end.toISOString() };
}

function validExistingRange(state: OutlookSyncState) {
  if (!state.deltaRangeStart || !state.deltaRangeEnd || !state.lastDeltaLink) return false;
  const today = Date.now();
  const start = Date.parse(state.deltaRangeStart);
  const end = Date.parse(state.deltaRangeEnd);
  return Number.isFinite(start) && Number.isFinite(end) && today >= start + 30 * 86400000 && today <= end - 90 * 86400000;
}

function graphDateToLocal(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function utcForGraph(localDateTime: string) {
  const date = new Date(localDateTime);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid scheduled time: ${localDateTime}`);
  return date.toISOString();
}

function durationMinutes(event: GraphEvent) {
  const start = event.start?.dateTime ? Date.parse(event.start.dateTime.endsWith('Z') ? event.start.dateTime : `${event.start.dateTime}Z`) : NaN;
  const end = event.end?.dateTime ? Date.parse(event.end.dateTime.endsWith('Z') ? event.end.dateTime : `${event.end.dateTime}Z`) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30;
  return Math.max(5, Math.round((end - start) / 60000));
}

function eventLink(state: OutlookSyncState, eventId: string) {
  return state.links.find((link) => link.outlookEventId === eventId || link.immutableEventId === eventId);
}

function upsertLink(links: OutlookLink[], next: OutlookLink) {
  return [...links.filter((link) => link.taskId !== next.taskId && link.outlookEventId !== next.outlookEventId), next];
}

export function applyOutlookScheduleUpdate(task: Task, event: Pick<GraphEvent, 'start' | 'end' | 'subject'>, updatedAt: string): Task {
  const scheduledAt = graphDateToLocal(event.start?.dateTime);
  if (!scheduledAt) return task;
  return {
    ...task,
    scheduledAt,
    durationMinutes: durationMinutes(event as GraphEvent),
    title: task.source === 'outlook' && event.subject?.trim() ? event.subject.trim() : task.title,
    // dueDate/possibleDate/dateConfidence are intentionally untouched. Outlook controls schedule, not academic deadlines.
    version: task.version + 1,
    updatedAt,
  };
}

export function clearOutlookSchedule(task: Task, updatedAt: string): Task {
  if (!task.scheduledAt) return task;
  return { ...task, scheduledAt: null, version: task.version + 1, updatedAt };
}

export async function connectOutlook(snapshot: AppSnapshot): Promise<AppSnapshot> {
  if (!isTauriRuntime()) throw new Error('Outlook connection requires the installed desktop app.');
  const { outlookTenantId, outlookClientId } = snapshot.settings;
  if (!outlookTenantId.trim() || !outlookClientId.trim()) throw new Error('Outlook tenant ID and public client ID are required.');
  const account = await invoke<OutlookAccountResult>('outlook_connect', { tenantId: outlookTenantId, clientId: outlookClientId });
  return {
    ...snapshot,
    outlook: { ...snapshot.outlook, state: 'ready', accountLabel: account.accountLabel, message: 'Connected to Outlook.' },
  };
}

export async function disconnectOutlook(snapshot: AppSnapshot): Promise<AppSnapshot> {
  if (isTauriRuntime()) await invoke('outlook_disconnect');
  return {
    ...snapshot,
    outlook: {
      state: 'disabled', accountLabel: null, lastDeltaLink: null, deltaRangeStart: null, deltaRangeEnd: null,
      lastSyncAt: null, links: [], message: 'Disconnected.',
    },
  };
}

export async function outlookStatus() {
  if (!isTauriRuntime()) return { connected: false, accountLabel: null as string | null };
  return invoke<{ connected: boolean; accountLabel: string | null }>('outlook_status');
}

export async function runOutlookSync(input: AppSnapshot): Promise<OutlookSyncResult> {
  if (!input.settings.outlookEnabled) {
    return { snapshot: { ...input, outlook: { ...input.outlook, state: 'disabled' } }, pulled: 0, pushed: 0, deleted: 0, message: 'Outlook synchronization is disabled.' };
  }
  if (!isTauriRuntime()) throw new Error('Outlook synchronization requires the installed desktop app.');

  let snapshot: AppSnapshot = { ...input, outlook: { ...input.outlook, state: 'syncing', message: null } };
  let pulled = 0;
  let pushed = 0;
  let deleted = 0;
  try {
    const status = await outlookStatus();
    if (!status.connected) snapshot = await connectOutlook(snapshot);

    const range = validExistingRange(snapshot.outlook)
      ? { start: snapshot.outlook.deltaRangeStart!, end: snapshot.outlook.deltaRangeEnd! }
      : windowRange();
    const deltaLink = validExistingRange(snapshot.outlook) ? snapshot.outlook.lastDeltaLink : null;
    const delta = await invoke<DeltaResult>('outlook_delta', { deltaLink, start: range.start, end: range.end });

    let tasks = [...snapshot.tasks];
    let links = [...snapshot.outlook.links];
    const now = new Date().toISOString();

    for (const event of delta.events) {
      let link = eventLink({ ...snapshot.outlook, links }, event.id);
      const markers = parseTorgyMarkers(event);
      if (!link && markers.taskId) {
        const existingTask = tasks.find((item) => item.id === markers.taskId);
        if (existingTask) {
          link = {
            taskId: existingTask.id, outlookEventId: event.id, immutableEventId: event.id, transactionId: crypto.randomUUID(),
            lastSyncedAt: now, taskVersion: markers.taskVersion ?? existingTask.version, eventChangeKey: event.changeKey ?? null,
          };
          links = upsertLink(links, link);
        }
      }
      const removed = Boolean(event['@removed']) || event.isCancelled === true;
      if (removed) {
        if (link) {
          const task = tasks.find((item) => item.id === link.taskId);
          if (task && task.scheduledAt) {
            const changed = clearOutlookSchedule(task, now);
            tasks = tasks.map((item) => item.id === task.id ? changed : item);
          }
          links = links.filter((item) => item.taskId !== link.taskId);
        }
        pulled += 1;
        continue;
      }

      const scheduledAt = graphDateToLocal(event.start?.dateTime);
      if (link) {
        const task = tasks.find((item) => item.id === link.taskId);
        if (task && scheduledAt) {
          const changed = applyOutlookScheduleUpdate(task, event, now);
          tasks = tasks.map((item) => item.id === changed.id ? changed : item);
          links = upsertLink(links, { ...link, outlookEventId: event.id, immutableEventId: event.id, eventChangeKey: event.changeKey ?? null, lastSyncedAt: now, taskVersion: changed.version });
          pulled += 1;
        }
        continue;
      }

      const isTorgyCategory = (event.categories ?? []).some((category) => category.toLowerCase() === 'torgy');
      if (!isTorgyCategory || !scheduledAt || !event.subject?.trim()) continue;
      const markerStudentId = markers.studentId && snapshot.students.some((student) => student.id === markers.studentId) ? markers.studentId : null;
      const imported: Task = {
        id: markers.taskId ?? crypto.randomUUID(), studentId: markerStudentId, course: null, title: event.subject.trim(), priority: 'normal', workStatus: 'todo',
        dueDate: null, possibleDate: null, scheduledAt, durationMinutes: durationMinutes(event), recurringRule: null,
        source: 'outlook', sourceRecordId: `outlook:${event.id}`, dateConfidence: 'undated', notes: 'Imported from an Outlook event categorized “Torgy”.',
        originDeviceId: snapshot.deviceId, createdByRole: snapshot.settings.role, createdAt: now, updatedAt: now, version: 1, deletedAt: null,
      };
      tasks = [imported, ...tasks];
      links = upsertLink(links, {
        taskId: imported.id, outlookEventId: event.id, immutableEventId: event.id, transactionId: crypto.randomUUID(), lastSyncedAt: now, taskVersion: markers.taskVersion ?? imported.version, eventChangeKey: event.changeKey ?? null,
      });
      pulled += 1;
    }

    snapshot = { ...snapshot, tasks, outlook: { ...snapshot.outlook, links } };

    for (const task of snapshot.tasks) {
      const link = snapshot.outlook.links.find((item) => item.taskId === task.id);
      if (task.deletedAt || !task.scheduledAt) {
        if (link) {
          await invoke('outlook_delete_event', { eventId: link.outlookEventId });
          links = links.filter((item) => item.taskId !== task.id);
          deleted += 1;
        }
        continue;
      }

      if (link && task.version <= link.taskVersion) continue;
      const startUtc = utcForGraph(task.scheduledAt);
      const end = new Date(startUtc);
      end.setMinutes(end.getMinutes() + (task.durationMinutes ?? 30));
      const transactionId = link?.transactionId ?? crypto.randomUUID();
      const result = await invoke<UpsertResult>('outlook_upsert_event', {
        eventId: link?.outlookEventId ?? null,
        transactionId,
        taskId: task.id,
        studentId: task.studentId,
        taskVersion: task.version,
        subject: task.title,
        startUtc,
        endUtc: end.toISOString(),
      });
      links = upsertLink(links, {
        taskId: task.id,
        outlookEventId: result.id,
        immutableEventId: result.id,
        transactionId,
        lastSyncedAt: now,
        taskVersion: task.version,
        eventChangeKey: result.changeKey,
      });
      pushed += 1;
    }

    const syncedAt = new Date().toISOString();
    snapshot = {
      ...snapshot,
      outlook: {
        ...snapshot.outlook,
        state: 'ready', accountLabel: status.accountLabel ?? snapshot.outlook.accountLabel,
        lastDeltaLink: delta.deltaLink, deltaRangeStart: range.start, deltaRangeEnd: range.end,
        lastSyncAt: syncedAt, links, message: `Outlook synchronized: ${pulled} pulled, ${pushed} pushed${deleted ? `, ${deleted} removed` : ''}.`,
      },
      updatedAt: syncedAt,
    };
    return { snapshot, pulled, pushed, deleted, message: snapshot.outlook.message ?? 'Outlook synchronized.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Outlook synchronization failed.';
    snapshot = { ...snapshot, outlook: { ...snapshot.outlook, state: 'error', message } };
    return { snapshot, pulled, pushed, deleted, message };
  }
}
