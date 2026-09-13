import type { AppSnapshot, ReadinessCheck, ReadinessReport, RuntimeInfo } from '../types';
import { copilotStatus } from './copilot';
import { outlookStatus } from './outlook';
import { canvasStatus } from './canvas';
import { managedAgentStatus, testCoordinatorShare } from './sync';
import { platformCapabilities } from '../platform/capabilities';

function check(key: ReadinessCheck['key'], label: string, status: ReadinessCheck['status'], detail: string): ReadinessCheck {
  return { key, label, status, detail };
}

export async function runReadinessCheck(snapshot: AppSnapshot, runtime: RuntimeInfo): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const capabilities = platformCapabilities(runtime);

  checks.push(check(
    'local-storage',
    'Local encrypted storage',
    capabilities.secureStorage ? 'ready' : 'warning',
    capabilities.secureStorage
      ? `${runtime.storage}${runtime.appDataDir ? ` · ${runtime.appDataDir}` : ''}`
      : `${runtime.storage}. Production Torgy requires OS-backed secure storage.`,
  ));

  if (!snapshot.settings.copilotEnabled) {
    checks.push(check('copilot', 'Microsoft Copilot', 'warning', 'Disabled. Torgy still works, but Info Dump uses the deterministic local fallback.'));
  } else if (!snapshot.settings.copilotUrl.trim()) {
    checks.push(check('copilot', 'Microsoft Copilot', 'blocked', 'Enabled but no approved Microsoft Copilot URL is configured.'));
  } else {
    try {
      const status = await copilotStatus();
      checks.push(check('copilot', 'Microsoft Copilot', status.open ? 'ready' : 'warning', status.open ? 'Approved Copilot WebView is open and ready for a DOM probe.' : 'Configured. Open/Test the Copilot bridge once to sign in and validate the live page.'));
    } catch (error) {
      checks.push(check('copilot', 'Microsoft Copilot', 'warning', error instanceof Error ? error.message : 'Configured but not yet validated.'));
    }
  }

  if (!snapshot.settings.outlookEnabled) {
    const configured = Boolean(snapshot.settings.outlookTenantId.trim() && snapshot.settings.outlookClientId.trim());
    checks.push(check('outlook', 'Outlook calendar', configured ? 'warning' : 'blocked', configured ? 'Configured but automatic two-way sync is disabled.' : 'Tenant ID and public client ID are still required from the university Microsoft tenant.'));
  } else {
    try {
      const status = await outlookStatus();
      checks.push(check('outlook', 'Outlook calendar', status.connected ? 'ready' : 'warning', status.connected ? `Connected${status.accountLabel ? ` as ${status.accountLabel}` : ''}.` : 'Configured but the Microsoft sign-in has not been completed on this installation.'));
    } catch (error) {
      checks.push(check('outlook', 'Outlook calendar', 'warning', error instanceof Error ? error.message : 'Outlook status could not be verified.'));
    }
  }

  if (!snapshot.settings.syncEnabled || snapshot.settings.syncTransportMode === 'disabled') {
    checks.push(check('sync', 'Coordinator/student sync', 'blocked', 'Synchronization is disabled.'));
  } else if (snapshot.settings.role === 'coordinator') {
    if (!capabilities.supportsCoordinator) {
      checks.push(check('sync', 'Coordinator/student sync', 'blocked', 'Coordinator features are not available in this Torgy student build.'));
    } else if (!snapshot.settings.syncSharePath.trim()) {
      checks.push(check('sync', 'Coordinator/student sync', 'blocked', 'The university staff-only sync drive path is not configured.'));
    } else {
      try {
        const detail = await testCoordinatorShare(snapshot.settings.syncSharePath);
        checks.push(check('sync', 'Coordinator/student sync', 'ready', detail));
      } catch (error) {
        checks.push(check('sync', 'Coordinator/student sync', 'blocked', error instanceof Error ? error.message : 'The university synchronization drive read/write check failed.'));
      }
    }
  } else if (snapshot.settings.syncTransportMode === 'portable-student') {
    const ready = capabilities.supportsPortableSync && capabilities.portableSyncConfigured;
    checks.push(check(
      'sync',
      'Coordinator/student sync',
      ready ? 'ready' : 'blocked',
      ready ? 'Portable encrypted student synchronization is configured.' : 'Portable student synchronization is not configured yet. Local encrypted Torgy data remains available offline.',
    ));
  } else if (snapshot.settings.syncTransportMode === 'managed-agent') {
    if (!capabilities.supportsManagedAgent) {
      checks.push(check('sync', 'Coordinator/student sync', 'blocked', 'The Windows managed sync agent is not available on this platform.'));
    } else {
      try {
        const agent = await managedAgentStatus();
        const active = agent.installed && agent.configured && agent.running && /^Managed sync active\./i.test(agent.message ?? '');
        const configured = agent.installed && agent.configured;
        checks.push(check(
          'sync',
          'Coordinator/student sync',
          active ? 'ready' : configured ? 'warning' : 'blocked',
          agent.message || (configured ? 'Managed SYSTEM agent is configured but has not completed a successful university-drive cycle yet.' : 'Managed SYSTEM agent still needs university deployment configuration.'),
        ));
      } catch (error) {
        checks.push(check('sync', 'Coordinator/student sync', 'blocked', error instanceof Error ? error.message : 'Managed sync agent status could not be verified.'));
      }
    }
  } else {
    checks.push(check('sync', 'Coordinator/student sync', 'blocked', 'The selected synchronization transport is not valid for this installation.'));
  }

  if (snapshot.settings.role === 'coordinator') {
    const paired = snapshot.students.filter((student) => student.pairingState === 'paired').length;
    const unpaired = snapshot.students.length - paired;
    checks.push(check('pairing', 'Student pairing', unpaired === 0 && snapshot.students.length > 0 ? 'ready' : 'warning', snapshot.students.length ? `${paired}/${snapshot.students.length} student installation(s) paired.` : 'No students have been added yet.'));
  } else {
    const student = snapshot.students[0];
    checks.push(check('pairing', 'Coordinator pairing', student?.pairingState === 'paired' ? 'ready' : 'warning', student?.pairingState === 'paired' ? 'This installation is paired to its coordinator mailbox.' : 'Enter a coordinator pairing code when the university sync transport is available.'));
  }

  if (snapshot.settings.academicImportMode === 'canvas') {
    try {
      const status = await canvasStatus();
      checks.push(check('academic-import', 'Academic assignment source', status.connected ? 'ready' : 'warning', status.connected ? `Direct Canvas is connected${status.accountLabel ? ` as ${status.accountLabel}` : ''}.` : 'Canvas mode selected, but no local Canvas connection is active. File/Docs import remains available.'));
    } catch (error) {
      checks.push(check('academic-import', 'Academic assignment source', 'warning', error instanceof Error ? error.message : 'Canvas status could not be checked.'));
    }
  } else {
    checks.push(check('academic-import', 'Academic assignment source', 'ready', snapshot.settings.academicImportMode === 'docs' ? 'Google Docs/Sheets export mode selected; imported files remain local to Torgy.' : 'Local file import mode selected.'));
  }

  checks.push(check('backup', 'Backup/restore', 'ready', 'Local JSON backup export and schema-validated restore are available. Store backups only in an approved location.'));

  return {
    checkedAt: new Date().toISOString(),
    ready: checks.every((item) => item.status !== 'blocked'),
    checks,
  };
}
