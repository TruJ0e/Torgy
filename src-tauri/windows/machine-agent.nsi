Unicode true
RequestExecutionLevel admin
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0-dev"
!endif
!ifndef AGENT_EXE
  !error "AGENT_EXE must point to the built torgy-machine-agent.exe"
!endif
!ifndef OUT_DIR
  !define OUT_DIR "."
!endif

Name "Torgy Machine Agent"
OutFile "${OUT_DIR}/Torgy_Machine_Agent_${VERSION}_x64-setup.exe"
InstallDir "$PROGRAMFILES64\Torgy Machine Agent"
ShowInstDetails show
ShowUninstDetails show

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Torgy Machine Agent"
!define LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Torgy"

Var LegacyUninstall
Var LegacyQuiet
Var MigrationBackup
Var ProgramData

Section "Install"
  SetRegView 64
  ReadEnvStr $ProgramData "ProgramData"
  ${If} $ProgramData == ""
    GetFullPathName $ProgramData "$WINDIR\..\ProgramData"
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /oname=torgy-machine-agent.exe "${AGENT_EXE}"

  ; A pre-0.4.4 Torgy install lived under Program Files and owned the SYSTEM task.
  ; Its uninstaller also removed ProgramData. Preserve encrypted transport/config
  ; state before invoking that legacy uninstaller, then restore it on this machine.
  StrCpy $MigrationBackup "$TEMP\Torgy-Migration-${VERSION}"
  ReadRegStr $LegacyUninstall HKLM "${LEGACY_UNINSTALL_KEY}" "QuietUninstallString"
  StrCpy $LegacyQuiet "1"
  ${If} $LegacyUninstall == ""
    ReadRegStr $LegacyUninstall HKLM "${LEGACY_UNINSTALL_KEY}" "UninstallString"
    StrCpy $LegacyQuiet "0"
  ${EndIf}

  ${If} $LegacyUninstall != ""
    DetailPrint "Migrating legacy per-machine Torgy installation..."
    RMDir /r "$MigrationBackup"
    CreateDirectory "$MigrationBackup"
    IfFileExists "$ProgramData\Torgy\*.*" 0 +2
      nsExec::ExecToLog '$SYSDIR\cmd.exe /D /C xcopy /E /I /H /Y "$ProgramData\Torgy\*" "$MigrationBackup\"'

    ${If} $LegacyQuiet == "1"
      ExecWait '$LegacyUninstall' $0
    ${Else}
      ExecWait '$LegacyUninstall /S' $0
    ${EndIf}
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "The legacy Torgy installation could not be removed (exit code $0). No Machine Agent task was created."
      Abort
    ${EndIf}

    CreateDirectory "$ProgramData\Torgy"
    IfFileExists "$MigrationBackup\*.*" 0 +2
      nsExec::ExecToLog '$SYSDIR\cmd.exe /D /C xcopy /E /I /H /Y "$MigrationBackup\*" "$ProgramData\Torgy\"'
    RMDir /r "$MigrationBackup"
  ${EndIf}

  CreateDirectory "$ProgramData\Torgy"
  CreateDirectory "$ProgramData\Torgy\agent"
  CreateDirectory "$ProgramData\Torgy\spool"
  CreateDirectory "$ProgramData\Torgy\spool\outgoing"
  CreateDirectory "$ProgramData\Torgy\spool\incoming"
  CreateDirectory "$ProgramData\Torgy\spool\acks"
  CreateDirectory "$ProgramData\Torgy\spool\pairing-requests"
  CreateDirectory "$ProgramData\Torgy\spool\pairing-responses"
  CreateDirectory "$ProgramData\Torgy\spool\processed"

  ; Agent configuration is SYSTEM/Admin only. Interactive users can manipulate
  ; only opaque encrypted transport packets in the spool.
  nsExec::ExecToLog 'icacls "$ProgramData\Torgy\agent" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"'
  nsExec::ExecToLog 'icacls "$ProgramData\Torgy\spool" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)M"'

  ; Replace any stale task. The new task executes only the administrator-protected
  ; Program Files Machine Agent binary, never the current-user desktop executable.
  nsExec::ExecToLog '$SYSDIR\schtasks.exe /End /TN "Torgy Sync Agent"'
  nsExec::ExecToLog '$SYSDIR\schtasks.exe /Delete /TN "Torgy Sync Agent" /F'
  ExecWait '$SYSDIR\schtasks.exe /Create /TN "Torgy Sync Agent" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /TR "$\"$INSTDIR\torgy-machine-agent.exe$\"" /F' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Torgy Machine Agent could not create the SYSTEM scheduled task (exit code $0)."
    Abort
  ${EndIf}
  ExecWait '$SYSDIR\schtasks.exe /Run /TN "Torgy Sync Agent"'

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "Torgy Machine Agent"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "TruJoe Digital"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetRegView 64
  ReadEnvStr $ProgramData "ProgramData"
  ${If} $ProgramData == ""
    GetFullPathName $ProgramData "$WINDIR\..\ProgramData"
  ${EndIf}
  nsExec::ExecToLog '$SYSDIR\schtasks.exe /End /TN "Torgy Sync Agent"'
  nsExec::ExecToLog '$SYSDIR\schtasks.exe /Delete /TN "Torgy Sync Agent" /F'
  Delete "$INSTDIR\torgy-machine-agent.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"

  ; Intentionally retain %ProgramData%\Torgy. It can contain encrypted queued
  ; packets and machine-DPAPI configuration needed for a later reinstall.
  DetailPrint "Torgy ProgramData transport state was preserved."
SectionEnd
