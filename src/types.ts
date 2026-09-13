export type Role = 'coordinator' | 'student';
export type Priority = 'low' | 'normal' | 'high';
export type WorkStatus = 'todo' | 'in-progress' | 'done';
export type DateConfidence = 'confirmed' | 'possible' | 'undated';
export type TaskSource = 'advisor' | 'student' | 'canvas' | 'docs' | 'outlook' | 'copilot' | 'manual-import';
export type SyncState = 'synced' | 'offline' | 'pending' | 'error';
export type IntegrationState = 'disabled' | 'ready' | 'connecting' | 'syncing' | 'offline' | 'error';
export type AppView = 'tasks' | 'calendar' | 'students' | 'settings';
export type SyncTransportMode = 'disabled' | 'staff-drive' | 'managed-agent' | 'portable-student';
export type PairingState = 'unpaired' | 'invite-created' | 'pairing' | 'paired' | 'error';

export interface Student {
  id: string;
  displayName: string;
  initials: string;
  canvasUserId: string | null;
  syncState: SyncState;
  pairingState: PairingState;
  mailboxId: string | null;
  peerPublicKey: string | null;
  lastSyncAt: string | null;
}

export interface Task {
  id: string;
  studentId: string | null;
  course: string | null;
  title: string;
  priority: Priority;
  workStatus: WorkStatus;
  /** Completion instant for the 12-hour Tasks window. Legacy snapshots may omit it. */
  completedAt?: string | null;
  /** Authoritative date only: official source date or a human-confirmed date. */
  dueDate: string | null;
  /** Unconfirmed date inferred from free text or speech. Never treated as authoritative. */
  possibleDate: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  recurringRule: string | null;
  source: TaskSource;
  sourceRecordId: string | null;
  dateConfidence: DateConfidence;
  notes: string;
  originDeviceId: string;
  createdByRole: Role;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
}

export interface InfoDumpItem {
  title: string;
  studentId: string | null;
  course: string | null;
  dueDate: string | null;
  possibleDate: string | null;
  time: string | null;
  durationMinutes: number | null;
  priority: Priority;
  notes: string;
  uncertain: boolean;
}

export interface InfoDumpResult {
  items: InfoDumpItem[];
  rawText: string;
  provider: 'copilot' | 'development-fallback';
}

export interface SyncEnvelope {
  envelopeId: string;
  mailboxId: string;
  studentId: string;
  deviceId: string;
  sequence: number;
  createdAt: string;
  operation: 'upsert-task' | 'delete-task' | 'ack';
  taskId: string;
  taskVersion: number;
  payload: Task | null;
}

export interface DuplicateReview {
  id: string;
  incomingTask: Task;
  possibleDuplicateId: string;
  score: number;
  createdAt: string;
}

export interface TaskAlias {
  aliasId: string;
  canonicalId: string;
}

export interface PairingRequest {
  requestId: string;
  codeHash: string;
  studentId: string;
  mailboxId: string;
  deviceId: string;
  studentPublicKey: string;
  createdAt: string;
}

export interface PairingResponse {
  requestId: string;
  studentId: string;
  mailboxId: string;
  coordinatorPublicKey: string;
  expiresAt: string;
}

export interface SyncRuntimeState {
  state: IntegrationState;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  message: string | null;
  processedEnvelopeIds: string[];
}

export interface OutlookLink {
  taskId: string;
  outlookEventId: string;
  immutableEventId: string | null;
  transactionId: string;
  lastSyncedAt: string;
  taskVersion: number;
  eventChangeKey: string | null;
}

export interface OutlookSyncState {
  state: IntegrationState;
  accountLabel: string | null;
  lastDeltaLink: string | null;
  deltaRangeStart: string | null;
  deltaRangeEnd: string | null;
  lastSyncAt: string | null;
  links: OutlookLink[];
  message: string | null;
}

export interface AppSettings {
  firstRunComplete: boolean;
  role: Role;
  coordinatorLabel: string;
  selectedStudentId: string;
  copilotEnabled: boolean;
  copilotUrl: string;
  outlookEnabled: boolean;
  outlookTenantId: string;
  outlookClientId: string;
  outlookAutoSyncSeconds: number;
  syncEnabled: boolean;
  syncTransportMode: SyncTransportMode;
  syncSharePath: string;
  syncAutoSeconds: number;
  academicImportMode: 'manual' | 'docs' | 'canvas';
  canvasBaseUrl: string;
}

export interface AppSnapshot {
  schemaVersion: 2;
  deviceId: string;
  students: Student[];
  tasks: Task[];
  taskAliases: TaskAlias[];
  duplicateReviews: DuplicateReview[];
  syncQueue: SyncEnvelope[];
  nextSyncSequence: number;
  sync: SyncRuntimeState;
  outlook: OutlookSyncState;
  settings: AppSettings;
  updatedAt: string;
}

export interface RuntimeInfo {
  platform: string;
  storage: string;
  appDataDir: string;
  appMode: 'advisor' | 'student' | 'development';
  supportsCoordinator: boolean;
  supportsStudent: boolean;
  supportsManagedAgent: boolean;
  supportsPortableSync: boolean;
  portableSyncConfigured: boolean;
  secureStorage: boolean;
  managedAgentInstalled: boolean;
  managedAgentConfigured: boolean;
}

export interface DeploymentDefaults {
  copilotUrl: string;
  outlookTenantId: string;
  outlookClientId: string;
  syncSharePath: string;
  canvasBaseUrl: string;
}

export interface AcademicImportRecord {
  studentId: string | null;
  studentName: string | null;
  course: string | null;
  title: string;
  officialDueDate: string | null;
  possibleDueDate: string | null;
  sourceRecordId: string | null;
  notes: string;
}

export interface CanvasAssignmentRecord {
  studentId: string;
  studentCanvasId: string;
  courseName: string;
  courseId: string;
  assignmentName: string;
  assignmentId: string;
  officialDueDate: string | null;
  possibleDueDate: string | null;
  detectedDateSource: 'title' | 'description' | 'module' | 'syllabus' | null;
  canvasUrl: string | null;
  published: boolean;
}

export type ReadinessStatus = 'ready' | 'warning' | 'blocked';

export interface ReadinessCheck {
  key: 'local-storage' | 'copilot' | 'outlook' | 'sync' | 'pairing' | 'academic-import' | 'backup';
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessReport {
  checkedAt: string;
  ready: boolean;
  checks: ReadinessCheck[];
}
