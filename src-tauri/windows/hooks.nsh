; Torgy desktop installer hooks (per-user install, 0.4.4+).
;
; Why: 0.4.3 and earlier installed per-machine (Program Files). 0.4.4 installs
; per-user, so the auto-updater's installer put a SECOND copy in %LOCALAPPDATA%
; while the shortcut kept launching the old per-machine 0.4.3, which then
; re-detected 0.4.4 forever. Before installing, remove that legacy copy once.
;
; The legacy uninstaller also deletes %ProgramData%\Torgy (encrypted transport and
; agent state), so back it up first and restore it afterwards, exactly like
; machine-agent.nsi does. Removing a per-machine install needs admin, so the steps
; run in ONE elevated cmd (a single UAC prompt). The uninstaller is run in place
; with _?= so it WAITS; without it NSIS copies itself to %TEMP% and returns at
; once, and the restore would run before the uninstaller wiped ProgramData.

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"

!define TORGY_LEGACY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Torgy"

!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  Push $2
  StrCpy $0 ""
  ReadRegStr $0 HKLM "${TORGY_LEGACY_KEY}" "InstallLocation"
  ${If} $0 == ""
    ; Fall back to the uninstaller path: "C:\Program Files\Torgy\uninstall.exe"
    ReadRegStr $1 HKLM "${TORGY_LEGACY_KEY}" "UninstallString"
    ${If} $1 != ""
      ${WordReplace} "$1" '"' '' "+" $1
      ${GetParent} "$1" $0
    ${EndIf}
  ${EndIf}
  ${WordReplace} "$0" '"' '' "+" $0

  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\uninstall.exe"
    DetailPrint "Removing the previous all-users Torgy installation ($0)..."
    InitPluginsDir
    FileOpen $2 "$PLUGINSDIR\torgy-legacy-migrate.cmd" w
    FileWrite $2 '@echo off$\r$\n'
    FileWrite $2 'set "BK=%ProgramData%\Torgy-Migration-Desktop"$\r$\n'
    FileWrite $2 'if exist "%BK%" rmdir /s /q "%BK%"$\r$\n'
    FileWrite $2 'if exist "%ProgramData%\Torgy\" xcopy /E /I /H /Y "%ProgramData%\Torgy\*" "%BK%\" >nul$\r$\n'
    FileWrite $2 '"$0\uninstall.exe" /S _?=$0$\r$\n'
    FileWrite $2 'if exist "$0\uninstall.exe" del /f /q "$0\uninstall.exe"$\r$\n'
    FileWrite $2 'rmdir "$0" 2>nul$\r$\n'
    FileWrite $2 'if exist "%BK%\" ( mkdir "%ProgramData%\Torgy" 2>nul & xcopy /E /I /H /Y "%BK%\*" "%ProgramData%\Torgy\" >nul & rmdir /s /q "%BK%" )$\r$\n'
    FileClose $2
    ExecShellWait "runas" "$SYSDIR\cmd.exe" '/D /C ""$PLUGINSDIR\torgy-legacy-migrate.cmd""' SW_HIDE

    ClearErrors
    ReadRegStr $1 HKLM "${TORGY_LEGACY_KEY}" "DisplayName"
    ${IfNot} ${Errors}
      MessageBox MB_ICONEXCLAMATION|MB_OK "The previous all-users copy of Torgy could not be removed (the administrator prompt may have been declined).$\r$\n$\r$\nPlease uninstall 'Torgy' from Settings > Apps, then open Torgy again. Until then Windows may keep starting the old version."
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend
