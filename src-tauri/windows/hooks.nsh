!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring Torgy managed synchronization agent..."
  CreateDirectory "$COMMONAPPDATA\Torgy"
  CreateDirectory "$COMMONAPPDATA\Torgy\agent"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool\outgoing"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool\incoming"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool\acks"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool\pairing-requests"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool\pairing-responses"
  CreateDirectory "$COMMONAPPDATA\Torgy\spool\processed"

  ; The interactive user may read/write only the opaque spool. Agent configuration
  ; is SYSTEM/Admin only. Every task packet in the spool is end-to-end encrypted.
  ; Use well-known SIDs so installation is not dependent on Windows display language.
  nsExec::ExecToLog 'icacls "$COMMONAPPDATA\Torgy\agent" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"'
  nsExec::ExecToLog 'icacls "$COMMONAPPDATA\Torgy\spool" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)M"'

  ; Run a short synchronization cycle once per minute as SYSTEM. The student's
  ; interactive account never gets a reusable staff-drive credential. The task is
  ; also run immediately so pairing/sync works directly after installation.
  ExecWait '$SYSDIR\schtasks.exe /Create /TN "Torgy Sync Agent" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /TR "$\"$INSTDIR\torgy.exe$\" --sync-agent" /F'
  ExecWait '$SYSDIR\schtasks.exe /Run /TN "Torgy Sync Agent"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Torgy managed synchronization agent..."
  nsExec::ExecToLog '$SYSDIR\schtasks.exe /End /TN "Torgy Sync Agent"'
  nsExec::ExecToLog '$SYSDIR\schtasks.exe /Delete /TN "Torgy Sync Agent" /F'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$COMMONAPPDATA\Torgy"
!macroend
