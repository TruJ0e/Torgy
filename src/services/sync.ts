import { invoke } from '@tauri-apps/api/core';
import type {
  AppSnapshot,
  DuplicateReview,
  PairingRequest,
  PairingResponse,
  Student,
  SyncEnvelope,
  SyncTransportMode,
  Task,
  TaskAlias,
} from '../types';
import { findPossibleDuplicate, mergeDuplicateTasks, shouldAutoMerge, taskFingerprint } from '../lib/dedupe';
import { getSyncTransport, type SecurePacketFile } from './syncTransport';

export type MergeResult =
  | { action: 'insert'; task: Task }
  | { action: 'update'; task: Task }
  | { action: 'merge'; task: Task; duplicateOf: string; score: number }
  | { action: 'review'; task: Task; possibleDuplicateId: string; score: number }
  | { action: 'ignore'; task: Task; reason: string };

export interface SyncCycleResult {
  snapshot: AppSnapshot;
  sent: number;
  received: number;
  merged: number;
  reviews: number;
  pairingRequests: number;
  message: string;
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function resolveAlias(taskId: string, aliases: TaskAlias[]) {
  let current = taskId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const next = aliases.find((alias) => alias.aliasId === current)?.canonicalId;
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

export function reconcileIncoming(incoming: Task, existing: Task[], aliases: TaskAlias[] = []): MergeResult {
  const canonicalIncomingId = resolveAlias(incoming.id, aliases);
  const normalizedIncoming = canonicalIncomingId === incoming.id ? incoming : { ...incoming, id: canonicalIncomingId };
  const sameId = existing.find((x) => x.id === normalizedIncoming.id);
  if (sameId) {
    if (normalizedIncoming.version < sameId.version) return { action: 'ignore', task: sameId, reason: 'older-version' };
    if (normalizedIncoming.version === sameId.version && normalizedIncoming.updatedAt <= sameId.updatedAt) {
      return { action: 'ignore', task: sameId, reason: 'already-current' };
    }
    return { action: 'update', task: normalizedIncoming };
  }

  const exactSource = normalizedIncoming.sourceRecordId
    ? existing.find((x) => x.sourceRecordId && x.sourceRecordId === normalizedIncoming.sourceRecordId)
    : null;
  if (exactSource) {
    return {
      action: 'merge',
      task: mergeDuplicateTasks(exactSource, normalizedIncoming, exactSource.id),
      duplicateOf: exactSource.id,
      score: 1,
    };
  }

  const exactFingerprint = existing.find((x) => taskFingerprint(x) === taskFingerprint(normalizedIncoming));
  if (exactFingerprint) {
    return {
      action: 'merge',
      task: mergeDuplicateTasks(exactFingerprint, normalizedIncoming, exactFingerprint.id),
      duplicateOf: exactFingerprint.id,
      score: 0.99,
    };
  }

  const possible = findPossibleDuplicate(normalizedIncoming, existing);
  if (!possible) return { action: 'insert', task: normalizedIncoming };

  if (shouldAutoMerge(normalizedIncoming, possible.task)) {
    return {
      action: 'merge',
      task: mergeDuplicateTasks(possible.task, normalizedIncoming, possible.task.id),
      duplicateOf: possible.task.id,
      score: possible.evidence.score,
    };
  }

  return {
    action: 'review',
    task: normalizedIncoming,
    possibleDuplicateId: possible.task.id,
    score: possible.evidence.score,
  };
}

export function createTaskEnvelope(args: {
  mailboxId: string;
  studentId: string;
  deviceId: string;
  sequence: number;
  operation: SyncEnvelope['operation'];
  task: Task;
}): SyncEnvelope {
  return {
    envelopeId: crypto.randomUUID(),
    mailboxId: args.mailboxId,
    studentId: args.studentId,
    deviceId: args.deviceId,
    sequence: args.sequence,
    createdAt: new Date().toISOString(),
    operation: args.operation,
    taskId: args.task.id,
    taskVersion: args.task.version,
    payload: args.operation === 'delete-task' ? null : args.task,
  };
}

function rememberProcessed(list: string[], envelopeId: string) {
  const next = [...list.filter((id) => id !== envelopeId), envelopeId];
  return next.slice(Math.max(0, next.length - 5000));
}

function addAlias(aliases: TaskAlias[], aliasId: string, canonicalId: string) {
  if (!aliasId || aliasId === canonicalId) return aliases;
  return [
    ...aliases.filter((alias) => alias.aliasId !== aliasId && alias.aliasId !== canonicalId),
    { aliasId, canonicalId },
  ];
}

export function applySyncEnvelope(snapshot: AppSnapshot, envelope: SyncEnvelope) {
  if (snapshot.sync.processedEnvelopeIds.includes(envelope.envelopeId)) {
    return { snapshot, received: false, merged: false, review: false };
  }

  const processed = rememberProcessed(snapshot.sync.processedEnvelopeIds, envelope.envelopeId);
  const canonicalTaskId = resolveAlias(envelope.taskId, snapshot.taskAliases);

  if (envelope.operation === 'delete-task') {
    const now = new Date().toISOString();
    const tasks = snapshot.tasks.map((task) => {
      if (task.id !== canonicalTaskId) return task;
      if (task.version > envelope.taskVersion) return task;
      return { ...task, deletedAt: task.deletedAt ?? now, updatedAt: envelope.createdAt, version: Math.max(task.version, envelope.taskVersion) };
    });
    return {
      snapshot: { ...snapshot, tasks, sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
      received: true,
      merged: false,
      review: false,
    };
  }

  if (!envelope.payload) {
    return {
      snapshot: { ...snapshot, sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
      received: true,
      merged: false,
      review: false,
    };
  }

  const incoming = { ...envelope.payload, id: canonicalTaskId };
  const result = reconcileIncoming(incoming, snapshot.tasks.filter((task) => !task.deletedAt), snapshot.taskAliases);

  if (result.action === 'ignore') {
    return {
      snapshot: { ...snapshot, sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
      received: true,
      merged: false,
      review: false,
    };
  }

  if (result.action === 'insert') {
    return {
      snapshot: { ...snapshot, tasks: [result.task, ...snapshot.tasks], sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
      received: true,
      merged: false,
      review: false,
    };
  }

  if (result.action === 'update') {
    const tasks = snapshot.tasks.map((task) => task.id === result.task.id ? result.task : task);
    return {
      snapshot: { ...snapshot, tasks, sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
      received: true,
      merged: false,
      review: false,
    };
  }

  if (result.action === 'merge') {
    const originalIncomingId = envelope.payload.id;
    const tasks = snapshot.tasks.map((task) => task.id === result.duplicateOf ? result.task : task);
    const taskAliases = addAlias(snapshot.taskAliases, originalIncomingId, result.duplicateOf);
    return {
      snapshot: { ...snapshot, tasks, taskAliases, sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
      received: true,
      merged: true,
      review: false,
    };
  }

  const review: DuplicateReview = {
    id: crypto.randomUUID(),
    incomingTask: result.task,
    possibleDuplicateId: result.possibleDuplicateId,
    score: result.score,
    createdAt: new Date().toISOString(),
  };
  const duplicateReviews = snapshot.duplicateReviews.some((item) => (
    item.incomingTask.id === review.incomingTask.id && item.possibleDuplicateId === review.possibleDuplicateId
  )) ? snapshot.duplicateReviews : [review, ...snapshot.duplicateReviews];
  return {
    snapshot: { ...snapshot, duplicateReviews, sync: { ...snapshot.sync, processedEnvelopeIds: processed } },
    received: true,
    merged: false,
    review: true,
  };
}

async function ensureIdentity() {
  if (!isTauriRuntime()) return 'development-public-key';
  const result = await invoke<{ publicKey: string }>('sync_identity');
  return result.publicKey;
}

async function seal(envelope: SyncEnvelope, peerPublicKey: string) {
  return invoke<string>('sync_seal_envelope', {
    envelope,
    peerPublicKey,
    mailboxId: envelope.mailboxId,
  });
}

async function open(packet: string, peerPublicKey: string, mailboxId: string) {
  return invoke<SyncEnvelope>('sync_open_packet', { packet, peerPublicKey, mailboxId });
}

async function sendEnvelope(mode: SyncTransportMode, shareRoot: string, envelope: SyncEnvelope, peerPublicKey: string) {
  const packet = await seal(envelope, peerPublicKey);
  const direction = mode === 'staff-drive' ? 'coordinator-to-student' : 'student-to-coordinator';
  await getSyncTransport(mode).send({
    shareRoot,
    mailboxId: envelope.mailboxId,
    direction,
    envelopeId: envelope.envelopeId,
    packet,
  });
}

async function receivePackets(mode: SyncTransportMode, shareRoot: string, student: Student): Promise<SecurePacketFile[]> {
  if (!student.mailboxId) return [];
  const direction = mode === 'staff-drive' ? 'student-to-coordinator' : 'coordinator-to-student';
  return getSyncTransport(mode).receive({ shareRoot, mailboxId: student.mailboxId, direction });
}

async function acknowledgePacket(mode: SyncTransportMode, shareRoot: string, student: Student, fileName: string) {
  if (!student.mailboxId) return;
  const direction = mode === 'staff-drive' ? 'student-to-coordinator' : 'coordinator-to-student';
  await getSyncTransport(mode).acknowledge({ shareRoot, mailboxId: student.mailboxId, direction, fileName });
}

export async function createCoordinatorPairingCode(snapshot: AppSnapshot, student: Student) {
  if (snapshot.settings.role !== 'coordinator') throw new Error('Only a coordinator installation can create student pairing codes.');
  if (snapshot.settings.syncTransportMode !== 'staff-drive') throw new Error('Coordinator pairing requires the staff-drive transport.');
  if (!snapshot.settings.syncSharePath.trim()) throw new Error('Set the staff synchronization drive path first.');
  if (!student.mailboxId) throw new Error('The student does not have a mailbox ID.');
  await ensureIdentity();
  return invoke<{ code: string; expiresAt: string }>('sync_create_pair_invite', {
    shareRoot: snapshot.settings.syncSharePath,
    studentId: student.id,
    mailboxId: student.mailboxId,
    expiresMinutes: 30,
  });
}

export async function requestStudentPairing(code: string, deviceId: string, mode: SyncTransportMode = 'managed-agent') {
  if (!code.trim()) throw new Error('Enter the pairing code from the coordinator.');
  await ensureIdentity();
  return getSyncTransport(mode).requestStudentPairing(code, deviceId);
}

export async function readStudentPairingResponse(mode: SyncTransportMode = 'managed-agent'): Promise<PairingResponse | null> {
  if (!isTauriRuntime()) return null;
  return getSyncTransport(mode).readStudentPairingResponse();
}

export async function configureManagedAgent(syncSharePath: string) {
  if (!syncSharePath.trim()) throw new Error('Enter the university staff synchronization drive path.');
  return invoke<{ launched: boolean }>('sync_configure_agent_elevated', { shareRoot: syncSharePath });
}

export async function managedAgentStatus() {
  if (!isTauriRuntime()) return { installed: false, configured: false, running: false, pairedMailboxId: null as string | null, message: 'Desktop runtime required.' };
  return invoke<{ installed: boolean; configured: boolean; running: boolean; pairedMailboxId: string | null; message: string }>('sync_agent_status');
}

export async function testCoordinatorShare(shareRoot: string) {
  if (!isTauriRuntime()) throw new Error('The staff-drive readiness test requires the installed desktop app.');
  if (!shareRoot.trim()) throw new Error('The university staff/faculty synchronization drive path is not configured.');
  return invoke<string>('sync_test_share', { shareRoot });
}

async function applyPairRequests(snapshot: AppSnapshot) {
  if (snapshot.settings.role !== 'coordinator' || snapshot.settings.syncTransportMode !== 'staff-drive' || !snapshot.settings.syncSharePath.trim()) {
    return { snapshot, count: 0 };
  }
  const requests = await invoke<PairingRequest[]>('sync_read_pair_requests', { shareRoot: snapshot.settings.syncSharePath });
  let next = snapshot;
  let count = 0;
  for (const request of requests) {
    const student = next.students.find((item) => item.id === request.studentId && item.mailboxId === request.mailboxId);
    if (!student) continue;
    next = {
      ...next,
      students: next.students.map((item) => item.id === student.id ? {
        ...item,
        peerPublicKey: request.studentPublicKey,
        pairingState: 'paired',
        syncState: 'pending',
      } : item),
    };
    await invoke('sync_ack_pair_request', { shareRoot: snapshot.settings.syncSharePath, requestId: request.requestId });
    count += 1;
  }
  return { snapshot: next, count };
}

async function applyStudentPairResponse(snapshot: AppSnapshot) {
  if (snapshot.settings.role !== 'student' || !['managed-agent', 'portable-student'].includes(snapshot.settings.syncTransportMode)) return snapshot;
  const response = await readStudentPairingResponse(snapshot.settings.syncTransportMode);
  if (!response) return snapshot;
  const oldStudent = snapshot.students[0];
  const oldId = oldStudent?.id ?? response.studentId;
  const student: Student = {
    id: response.studentId,
    displayName: oldStudent?.displayName || 'Student',
    initials: oldStudent?.initials || 'S',
    canvasUserId: oldStudent?.canvasUserId ?? null,
    syncState: 'pending',
    pairingState: 'paired',
    mailboxId: response.mailboxId,
    peerPublicKey: response.coordinatorPublicKey,
    lastSyncAt: null,
  };
  const tasks = snapshot.tasks.map((task) => task.studentId === oldId ? { ...task, studentId: response.studentId } : task);
  let sequence = snapshot.nextSyncSequence;
  let syncQueue = snapshot.syncQueue.map((envelope) => envelope.studentId === oldId ? {
    ...envelope,
    studentId: response.studentId,
    mailboxId: response.mailboxId,
    payload: envelope.payload ? { ...envelope.payload, studentId: response.studentId } : null,
  } : envelope);
  // Tasks created before pairing had no mailbox and therefore could not be queued.
  // Seed a one-time full upsert set after pairing; dedupe/version logic makes this safe.
  const queuedTaskIds = new Set(syncQueue.map((envelope) => envelope.taskId));
  for (const task of tasks.filter((item) => item.studentId === response.studentId && !item.deletedAt)) {
    if (queuedTaskIds.has(task.id)) continue;
    syncQueue.push(createTaskEnvelope({ mailboxId: response.mailboxId, studentId: response.studentId, deviceId: snapshot.deviceId, sequence, operation: 'upsert-task', task }));
    sequence += 1;
  }
  await getSyncTransport(snapshot.settings.syncTransportMode).clearStudentPairingResponse();
  return {
    ...snapshot,
    students: [student],
    tasks,
    syncQueue,
    nextSyncSequence: sequence,
    settings: { ...snapshot.settings, selectedStudentId: response.studentId },
  };
}

export async function runSyncCycle(input: AppSnapshot): Promise<SyncCycleResult> {
  if (!input.settings.syncEnabled || input.settings.syncTransportMode === 'disabled') {
    return { snapshot: { ...input, sync: { ...input.sync, state: 'disabled', message: null } }, sent: 0, received: 0, merged: 0, reviews: 0, pairingRequests: 0, message: 'Synchronization is disabled.' };
  }
  if (!isTauriRuntime()) {
    return { snapshot: { ...input, sync: { ...input.sync, state: 'offline', message: 'Desktop runtime required for synchronization.' } }, sent: 0, received: 0, merged: 0, reviews: 0, pairingRequests: 0, message: 'Desktop runtime required.' };
  }
  if (input.settings.role === 'coordinator' && input.settings.syncTransportMode !== 'staff-drive') {
    return { snapshot: { ...input, sync: { ...input.sync, state: 'error', message: 'Coordinator installations must use the staff-drive transport.' } }, sent: 0, received: 0, merged: 0, reviews: 0, pairingRequests: 0, message: 'Coordinator installations must use the staff-drive transport.' };
  }
  if (input.settings.role === 'student' && !['managed-agent', 'portable-student'].includes(input.settings.syncTransportMode)) {
    return { snapshot: { ...input, sync: { ...input.sync, state: 'error', message: 'Student installations require an approved student synchronization transport.' } }, sent: 0, received: 0, merged: 0, reviews: 0, pairingRequests: 0, message: 'Student installations require an approved student synchronization transport.' };
  }
  const selectedTransport = getSyncTransport(input.settings.syncTransportMode);
  if (!selectedTransport.configured) {
    const message = input.settings.syncTransportMode === 'portable-student'
      ? 'Portable student synchronization is not configured yet. Encrypted local data remains available offline.'
      : 'Synchronization transport is not configured.';
    return { snapshot: { ...input, sync: { ...input.sync, state: 'offline', message } }, sent: 0, received: 0, merged: 0, reviews: 0, pairingRequests: 0, message };
  }

  const attemptAt = new Date().toISOString();
  let snapshot: AppSnapshot = { ...input, sync: { ...input.sync, state: 'syncing', lastAttemptAt: attemptAt, message: null } };
  let sent = 0;
  let received = 0;
  let merged = 0;
  let reviews = 0;
  let pairingRequests = 0;

  try {
    await ensureIdentity();
    const pairedStudentSnapshot = await applyStudentPairResponse(snapshot);
    snapshot = pairedStudentSnapshot;
    const pairing = await applyPairRequests(snapshot);
    snapshot = pairing.snapshot;
    pairingRequests += pairing.count;

    const queueRemaining: SyncEnvelope[] = [];
    for (const envelope of snapshot.syncQueue) {
      const student = snapshot.students.find((item) => item.id === envelope.studentId);
      if (!student?.peerPublicKey || student.pairingState !== 'paired') {
        queueRemaining.push(envelope);
        continue;
      }
      try {
        await sendEnvelope(snapshot.settings.syncTransportMode, snapshot.settings.syncSharePath, envelope, student.peerPublicKey);
        sent += 1;
      } catch {
        queueRemaining.push(envelope);
      }
    }
    snapshot = { ...snapshot, syncQueue: queueRemaining };

    const studentsToPoll = snapshot.settings.role === 'student' ? snapshot.students.slice(0, 1) : snapshot.students;
    for (const student of studentsToPoll) {
      if (!student.mailboxId || !student.peerPublicKey || student.pairingState !== 'paired') continue;
      const files = await receivePackets(snapshot.settings.syncTransportMode, snapshot.settings.syncSharePath, student);
      for (const file of files) {
        try {
          const envelope = await open(file.packet, student.peerPublicKey, student.mailboxId);
          const applied = applySyncEnvelope(snapshot, envelope);
          snapshot = applied.snapshot;
          received += applied.received ? 1 : 0;
          merged += applied.merged ? 1 : 0;
          reviews += applied.review ? 1 : 0;
          await acknowledgePacket(snapshot.settings.syncTransportMode, snapshot.settings.syncSharePath, student, file.fileName);
        } catch {
          // Do not acknowledge unreadable packets. They remain available for diagnosis/retry.
        }
      }
    }

    const syncedAt = new Date().toISOString();
    snapshot = {
      ...snapshot,
      students: snapshot.students.map((student) => student.pairingState === 'paired' ? { ...student, syncState: 'synced', lastSyncAt: syncedAt } : student),
      sync: { ...snapshot.sync, state: 'ready', lastSyncAt: syncedAt, message: queueRemaining.length ? `${queueRemaining.length} change(s) waiting for pairing/transport.` : 'Synchronized.' },
      updatedAt: syncedAt,
    };
    return { snapshot, sent, received, merged, reviews, pairingRequests, message: `Sent ${sent}, received ${received}${merged ? `, merged ${merged}` : ''}${reviews ? `, review ${reviews}` : ''}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronization failed.';
    snapshot = { ...snapshot, sync: { ...snapshot.sync, state: 'error', message }, updatedAt: new Date().toISOString() };
    return { snapshot, sent, received, merged, reviews, pairingRequests, message };
  }
}

export function resolveDuplicateReview(snapshot: AppSnapshot, reviewId: string, resolution: 'merge' | 'keep-separate'): AppSnapshot {
  const review = snapshot.duplicateReviews.find((item) => item.id === reviewId);
  if (!review) return snapshot;
  const remaining = snapshot.duplicateReviews.filter((item) => item.id !== reviewId);
  if (resolution === 'keep-separate') {
    return { ...snapshot, tasks: [review.incomingTask, ...snapshot.tasks], duplicateReviews: remaining };
  }
  const existing = snapshot.tasks.find((task) => task.id === review.possibleDuplicateId);
  if (!existing) return { ...snapshot, tasks: [review.incomingTask, ...snapshot.tasks], duplicateReviews: remaining };
  const mergedTask = mergeDuplicateTasks(existing, review.incomingTask, existing.id);
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => task.id === existing.id ? mergedTask : task),
    taskAliases: addAlias(snapshot.taskAliases, review.incomingTask.id, existing.id),
    duplicateReviews: remaining,
  };
}
