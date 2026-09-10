# Student / coordinator synchronization

## Principle

Do not share the live Torgy database and do not expose the coordinator laptop as a server. Each installation owns its local state and exchanges encrypted, versioned task envelopes.

## Envelope

Each change includes:

- envelope UUID
- task UUID
- student UUID
- random mailbox UUID
- origin device UUID
- sequence number
- task version
- created timestamp
- operation (`upsert-task` / `delete-task`)
- task payload for upserts

The payload is encrypted before it enters the transport location.

## Pairing

1. Coordinator creates a one-time pairing code from the staff-authorized installation.
2. The invite is represented on the staff/faculty transport using a hash of that code, a random mailbox ID, student ID, coordinator public key, and expiration.
3. Student enters the code in Torgy.
4. Student Torgy writes a local pairing request to the ProgramData spool.
5. The SYSTEM sync worker uses its approved machine/service identity to locate the matching invite and moves the request/response.
6. Coordinator accepts the request during normal sync and stores the student's public key.
7. Student stores the coordinator public key and mailbox ID.
8. Future task packets are end-to-end encrypted between those paired installations.

Re-pairing to a different mailbox clears old local transport artifacts before the new mailbox is used.

## Staff/faculty-only transport

Students do not receive interactive access to the synchronization location. The normal student process contains no reusable staff-share password.

```text
Student Torgy
  ↕ local encrypted spool
SYSTEM managed worker
  ↕ university-approved machine/service identity
staff/faculty-only sync location
  ↕ staff identity
Coordinator Torgy
```

The university controls the remote ACL. A domain SYSTEM process typically accesses network resources as the computer account; IT may instead choose another approved service identity/deployment model.

## Offline behavior

All changes are committed locally first. If transport is unavailable, envelopes remain queued. When connectivity returns, queued packets are sent and remote packets are applied.

The sync protocol is idempotent: duplicate delivery of the same envelope does not duplicate the task.

## Duplicate handling

1. Same Torgy task UUID → newer version wins.
2. Same authoritative source ID → merge automatically.
3. Same deterministic fingerprint → merge automatically.
4. Independent same-student tasks with strongly equivalent title/course/date → high-confidence automatic merge.
5. Similar but ambiguous items → duplicate review rather than silent deletion.

Examples:

- `Chemistry Test` + `Chem test`, same student/course/date → merge.
- `Chemistry Test` + `Chemistry worksheet` → keep separate or require review.

Confirmed dates win over Possible dates during merge. Merged IDs become aliases to the canonical task so later packets converge instead of recreating the duplicate.

## Remote file layout

Remote mailbox folder names are opaque random IDs rather than student names. Conceptually:

```text
TorgySync/
  pairing/
  mailboxes/
    <random-mailbox-id>/
      student-to-coordinator/
      coordinator-to-student/
```

The live database is never placed there.
