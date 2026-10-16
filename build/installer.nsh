!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifdef BUILD_UNINSTALLER
  Var TWCleanupMode
  Var TWKeepRadio
  Var TWPurgeRadio
  Var TWProfile
  Var TWNodeEnvironment

  !macro customUnInit
    StrCpy $TWCleanupMode "keep"
    ${IfNot} ${isUpdated}
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "/PURGE" $R1
      ${IfNot} ${Errors}
        StrCpy $TWCleanupMode "purge"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.TWChooseMode un.TWConfirmMode
  !macroend

  !macro TW_UNINSTALL_FUNCTIONS
  Function un.TWChooseMode
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$(un.TWTitle)" "$(un.TWSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateRadioButton} 0 10u 100% 14u "$(un.TWKeep)"
    Pop $TWKeepRadio
    ${NSD_AddStyle} $TWKeepRadio ${WS_GROUP}
    ${NSD_CreateLabel} 12u 28u 95% 32u "$(un.TWKeepHint)"
    Pop $0
    ${NSD_CreateRadioButton} 0 65u 100% 14u "$(un.TWPurge)"
    Pop $TWPurgeRadio
    ${NSD_CreateLabel} 12u 83u 95% 42u "$(un.TWPurgeHint)"
    Pop $0
    ${NSD_CreateLabel} 0 137u 100% 30u "$(un.TWProtect)"
    Pop $0
    ${If} $TWCleanupMode == "purge"
      ${NSD_Check} $TWPurgeRadio
    ${Else}
      ${NSD_Check} $TWKeepRadio
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function un.TWConfirmMode
    ${NSD_GetState} $TWPurgeRadio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $TWCleanupMode "purge"
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "$(un.TWConfirm)" IDYES tw_confirmed
      Abort
      tw_confirmed:
    ${Else}
      StrCpy $TWCleanupMode "keep"
    ${EndIf}
  FunctionEnd

  !macroend

  !macro customUnInstall
    ; Upgrade-driven uninstalls always preserve data, even with /PURGE.
    ${IfNot} ${isUpdated}
    ${AndIf} $TWCleanupMode == "purge"
      SetShellVarContext current
      GetFullPathName $TWProfile "$APPDATA\TeXWeave"
      ReadEnvStr $TWNodeEnvironment "ELECTRON_RUN_AS_NODE"
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1") i .r0'
      nsExec::ExecToStack /TIMEOUT=300000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\uninstall-cleanup.cjs" --mode=purge --profile "$TWProfile"'
      Pop $0
      Pop $1
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "$TWNodeEnvironment") i .r2'
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      ${If} $0 != "0"
        DetailPrint "$1"
        MessageBox MB_OK|MB_ICONSTOP "$(un.TWCleanupFailed)" /SD IDOK
        SetErrorLevel 1
        Abort
      ${EndIf}
    ${EndIf}
  !macroend
!else
  Var TWExistingDirectory
  Var TWUpdateCheckbox

  !macro customPageAfterChangeDir
    Page custom TWUpdatePage TWUpdateLeave
  !macroend

  !macro TW_INSTALL_FUNCTIONS
  Function TWUpdatePage
    StrCpy $TWExistingDirectory ""
    ${If} $installMode == "all"
      StrCpy $TWExistingDirectory "$perMachineInstallationFolder"
    ${Else}
      StrCpy $TWExistingDirectory "$perUserInstallationFolder"
    ${EndIf}
    IfFileExists "$TWExistingDirectory\${APP_EXECUTABLE_FILENAME}" tw_existing_found
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 tw_no_existing
    StrCpy $TWExistingDirectory "$INSTDIR"
    tw_existing_found:
    !insertmacro MUI_HEADER_TEXT "$(TWUpdateTitle)" "$(TWUpdateSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 30u "$TWExistingDirectory"
    Pop $0
    ${NSD_CreateCheckbox} 0 40u 100% 24u "$(TWUpdateChoice)"
    Pop $TWUpdateCheckbox
    ${NSD_Check} $TWUpdateCheckbox
    ${NSD_CreateLabel} 0 80u 100% 65u "$(TWUpdateHint)"
    Pop $0
    nsDialogs::Show
    Return
    tw_no_existing:
    Abort
  FunctionEnd

  Function TWUpdateLeave
    ${NSD_GetState} $TWUpdateCheckbox $0
    ${If} $0 != ${BST_CHECKED}
      Abort
    ${EndIf}
  FunctionEnd
  !macroend
!endif

!macro customHeader
  !include "${PROJECT_DIR}\build\uninstall-messages.nsh"
  !ifdef BUILD_UNINSTALLER
    !insertmacro TW_UNINSTALL_FUNCTIONS
  !else
    !insertmacro TW_INSTALL_FUNCTIONS
  !endif
!macroend
