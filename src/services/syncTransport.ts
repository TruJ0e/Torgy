import { invoke } from '@tauri-apps/api/core';
import type { PairingResponse, SyncTransportMode } from '../types';

export interface SecurePacketFile {
  fileName: string;
  packet: string;
}

export interface PacketSendArgs {
  shareRoot: string;
  mailboxId: string;
  direction: 'student-to-coordinator' | 'coordinator-to-student';
  envelopeId: string;
  packet: string;
}

export interface PacketReceiveArgs {
  shareRoot: string;
  mailboxId: string;
  direction: 'student-to-coordinator' | 'coordinator-to-student';
}

export interface PacketAckArgs extends PacketReceiveArgs {
  fileName: string;
}

export interface SyncTransport {
  readonly mode: SyncTransportMode;
  readonly configured: boolean;
  send(args: PacketSendArgs): Promise<void>;
  receive(args: PacketReceiveArgs): Promise<SecurePacketFile[]>;
  acknowledge(args: PacketAckArgs): Promise<void>;
  requestStudentPairing(code: string, deviceId: string): Promise<{ requestId: string; codeHash: string }>;
  readStudentPairingResponse(): Promise<PairingResponse | null>;
  clearStudentPairingResponse(): Promise<void>;
}
const unsupportedPairing = async (): Promise<never> => {
  throw new Error('This synchronization transport does not provide student pairing.');
};

const staffDriveTransport: SyncTransport = {
  mode: 'staff-drive',
  configured: true,
  async send(args) {
    await invoke('sync_drive_send', { ...args });
  },
  async receive(args) {
    return invoke<SecurePacketFile[]>('sync_drive_receive', { ...args });
  },
  async acknowledge(args) {
    await invoke('sync_drive_ack', { ...args });
  },
  requestStudentPairing: unsupportedPairing,
  readStudentPairingResponse: async () => null,
  clearStudentPairingResponse: async () => undefined,
};

const managedAgentTransport: SyncTransport = {
  mode: 'managed-agent',
  configured: true,
  async send(args) {
    await invoke('sync_spool_send', { mailboxId: args.mailboxId, envelopeId: args.envelopeId, packet: args.packet });
  },
  async receive() {
    return invoke<SecurePacketFile[]>('sync_spool_receive');
  },
  async acknowledge(args) {
    await invoke('sync_spool_ack', { fileName: args.fileName });
  },
  async requestStudentPairing(code, deviceId) {
    return invoke<{ requestId: string; codeHash: string }>('sync_request_pairing', { code, deviceId });
  },
  async readStudentPairingResponse() {
    return invoke<PairingResponse | null>('sync_pairing_response');
  },
  async clearStudentPairingResponse() {
    await invoke('sync_clear_pairing_response');
  },
};
const portableMessage = 'Portable student synchronization is not configured yet. Torgy will keep working from encrypted local storage.';

const portableStudentTransport: SyncTransport = {
  mode: 'portable-student',
  configured: false,
  async send() { throw new Error(portableMessage); },
  async receive() { throw new Error(portableMessage); },
  async acknowledge() { throw new Error(portableMessage); },
  async requestStudentPairing() { throw new Error(portableMessage); },
  async readStudentPairingResponse() { return null; },
  async clearStudentPairingResponse() { return undefined; },
};

const disabledTransport: SyncTransport = {
  mode: 'disabled',
  configured: false,
  async send() { throw new Error('Torgy synchronization transport is disabled.'); },
  async receive() { return []; },
  async acknowledge() { return undefined; },
  async requestStudentPairing() { throw new Error('Torgy synchronization transport is disabled.'); },
  async readStudentPairingResponse() { return null; },
  async clearStudentPairingResponse() { return undefined; },
};

export function getSyncTransport(mode: SyncTransportMode): SyncTransport {
  if (mode === 'staff-drive') return staffDriveTransport;
  if (mode === 'managed-agent') return managedAgentTransport;
  if (mode === 'portable-student') return portableStudentTransport;
  return disabledTransport;
}

export function portableStudentSyncMessage() {
  return portableMessage;
}
