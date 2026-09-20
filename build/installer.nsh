; TeXWeave assisted installer extensions.
; The normal electron-builder NSIS pages remain in charge of installation,
; shortcuts and rollback. This file only adds product-specific choices and a
; durable component manifest; it never deletes projects or external TeX.
!include LogicLib.nsh
!include nsDialogs.nsh
!include WinVer.nsh

!ifndef BUILD_UNINSTALLER
Var TwOptionsDialog
Var TwRecommendedRadio
Var TwCustomRadio
Var TwLanguageCheck
Var TwSpellCheck
Var TwLatexCheck
Var TwInstallMode
Var TwUiLanguageCombo
Var TwUiLanguage

!macro customInit
  StrCpy $TwInstallMode "recommended"
  StrCpy $TwUiLanguage "en"
!macroend

!macro customWelcomePage
  Page custom TeXWeaveWelcomeCreate TeXWeaveWelcomeLeave
!macroend

Function TeXWeaveWelcomeCreate
  nsDialogs::Create 1018
  Pop $TwOptionsDialog
  ${If} $TwOptionsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Welcome to TeXWeave"
  Pop $0
  ${NSD_CreateLabel} 0 30u 100% 38u "A local-first LaTeX workspace. This installer keeps the core application separate from your projects and external TeX distributions."
  Pop $0
  ${NSD_CreateLabel} 0 82u 45% 16u "Installer language"
  Pop $0
  ${NSD_CreateComboBox} 48% 78u 52% 70u ""
  Pop $TwUiLanguageCombo
  ${NSD_CB_AddString} $TwUiLanguageCombo "English"
  ${NSD_CB_AddString} $TwUiLanguageCombo "简体中文"
  ${NSD_CB_AddString} $TwUiLanguageCombo "繁體中文"
  ${NSD_CB_AddString} $TwUiLanguageCombo "日本語"
  ${NSD_CB_AddString} $TwUiLanguageCombo "한국어"
  ${NSD_CB_AddString} $TwUiLanguageCombo "Français"
  ReadRegStr $0 HKCU "Control Panel\International" "LocaleName"
  ${IfThen} $0 == "zh-CN" ${|} ${NSD_CB_SelectString} $TwUiLanguageCombo "简体中文" ${|}
  ${IfThen} $0 == "zh-TW" ${|} ${NSD_CB_SelectString} $TwUiLanguageCombo "繁體中文" ${|}
  ${IfThen} $0 == "ja-JP" ${|} ${NSD_CB_SelectString} $TwUiLanguageCombo "日本語" ${|}
  ${IfThen} $0 == "ko-KR" ${|} ${NSD_CB_SelectString} $TwUiLanguageCombo "한국어" ${|}
  ${IfThen} $0 == "fr-FR" ${|} ${NSD_CB_SelectString} $TwUiLanguageCombo "Français" ${|}
  ${IfThen} $0 == "en-US" ${|} ${NSD_CB_SelectString} $TwUiLanguageCombo "English" ${|}
  nsDialogs::Show
FunctionEnd

Function TeXWeaveWelcomeLeave
  ${If} $TwUiLanguageCombo != ""
    ${NSD_GetText} $TwUiLanguageCombo $TwUiLanguage
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom TeXWeaveOptionsCreate TeXWeaveOptionsLeave
!macroend

Function TeXWeaveOptionsCreate
  nsDialogs::Create 1018
  Pop $TwOptionsDialog
  ${If} $TwOptionsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "TeXWeave setup profile"
  Pop $0
  ${NSD_CreateLabel} 0 22u 100% 34u "Choose the environment components that TeXWeave should manage. Existing external tools are detected and reused when possible."
  Pop $0
  ${NSD_CreateRadioButton} 0 64u 100% 16u "Recommended (detect and reuse existing tools)"
  Pop $TwRecommendedRadio
  ${NSD_CreateRadioButton} 0 84u 100% 16u "Custom (choose optional resources)"
  Pop $TwCustomRadio
  ${NSD_Check} $TwRecommendedRadio

  ${NSD_CreateLabel} 0 118u 100% 18u "Optional components"
  Pop $0
  ${NSD_CreateCheckbox} 12u 140u 100% 16u "Install bundled language packs"
  Pop $TwLanguageCheck
  ${NSD_CreateCheckbox} 12u 160u 100% 16u "Enable spell-check resources"
  Pop $TwSpellCheck
  ${NSD_CreateCheckbox} 12u 180u 100% 16u "Prepare LaTeX runtime detection"
  Pop $TwLatexCheck
  ${NSD_Check} $TwLanguageCheck
  ${NSD_Check} $TwSpellCheck
  ${NSD_Check} $TwLatexCheck

  nsDialogs::Show
FunctionEnd

Function TeXWeaveOptionsLeave
  ${NSD_GetState} $TwRecommendedRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $TwInstallMode "recommended"
  ${Else}
    StrCpy $TwInstallMode "custom"
  ${EndIf}
FunctionEnd
!endif

!macro customInstall
  ; Persist only installer intent. The application validates actual tools on
  ; every startup and upgrades this file with discovered ownership/version.
  ${If} $TwLanguageCheck == ""
    StrCpy $1 "true"
    StrCpy $2 "true"
    StrCpy $3 "true"
  ${Else}
    ${NSD_GetState} $TwLanguageCheck $1
    ${If} $1 == ${BST_CHECKED}
      StrCpy $1 "true"
    ${Else}
      StrCpy $1 "false"
    ${EndIf}
    ${NSD_GetState} $TwSpellCheck $2
    ${If} $2 == ${BST_CHECKED}
      StrCpy $2 "true"
    ${Else}
      StrCpy $2 "false"
    ${EndIf}
    ${NSD_GetState} $TwLatexCheck $3
    ${If} $3 == ${BST_CHECKED}
      StrCpy $3 "true"
    ${Else}
      StrCpy $3 "false"
    ${EndIf}
  ${EndIf}
  CreateDirectory "$APPDATA\TeXWeave\config"
  FileOpen $0 "$APPDATA\TeXWeave\config\installer-selection.json" w
  FileWrite $0 "{$\"installMode$\":$\"$TwInstallMode$\",$\"uiLanguage$\":$\"$TwUiLanguage$\",$\"languagePacks$\":$1,$\"spellcheck$\":$2,$\"latexRuntime$\":$3}"
  FileClose $0
  CreateDirectory "$APPDATA\TeXWeave\config"
  FileOpen $0 "$APPDATA\TeXWeave\config\installer-metadata.json" w
  FileWrite $0 "{$\"product$\":$\"TeXWeave$\",$\"appVersion$\":$\"${VERSION}$\",$\"installDirectory$\":$\"$INSTDIR$\"}"
  FileClose $0
!macroend

!macro customUnInit
  ; App data is intentionally preserved by default. Advanced cleanup is
  ; explicit and can be invoked by the administrator with --delete-app-data.
!macroend

!ifdef BUILD_UNINSTALLER
Var TwRemoveSettings
Var TwRemoveThemes
Var TwRemoveLanguages
Var TwRemoveSpellcheck
Var TwRemoveTemplates
Var TwRemoveCache

!macro customUnWelcomePage
  Page custom TeXWeaveUninstallOptionsCreate TeXWeaveUninstallOptionsLeave
!macroend

Function TeXWeaveUninstallOptionsCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 18u "TeXWeave uninstall options"
  Pop $0
  ${NSD_CreateLabel} 0 22u 100% 34u "Application files and shortcuts will be removed. Projects and external LaTeX installations are never removed by this page."
  Pop $0
  ${NSD_CreateCheckbox} 0 68u 100% 16u "Remove TeXWeave settings and environment records"
  Pop $TwRemoveSettings
  ${NSD_CreateCheckbox} 0 88u 100% 16u "Remove custom themes"
  Pop $TwRemoveThemes
  ${NSD_CreateCheckbox} 0 108u 100% 16u "Remove language packs"
  Pop $TwRemoveLanguages
  ${NSD_CreateCheckbox} 0 128u 100% 16u "Remove spell-check dictionaries"
  Pop $TwRemoveSpellcheck
  ${NSD_CreateCheckbox} 0 148u 100% 16u "Remove templates"
  Pop $TwRemoveTemplates
  ${NSD_CreateCheckbox} 0 168u 100% 16u "Remove TeXWeave cache"
  Pop $TwRemoveCache
  nsDialogs::Show
FunctionEnd

Function TeXWeaveUninstallOptionsLeave
FunctionEnd

!macro customUnInstall
  SetShellVarContext current
  ${NSD_GetState} $TwRemoveSettings $0
  ${If} $0 == ${BST_CHECKED}
    Delete "$APPDATA\TeXWeave\settings.json"
    Delete "$APPDATA\TeXWeave\registry.sqlite"
    Delete "$APPDATA\TeXWeave\registry.sqlite-wal"
    Delete "$APPDATA\TeXWeave\registry.sqlite-shm"
    RMDir /r "$APPDATA\TeXWeave\config"
  ${EndIf}
  ${NSD_GetState} $TwRemoveThemes $0
  ${If} $0 == ${BST_CHECKED}
    RMDir /r "$APPDATA\TeXWeave\themes"
  ${EndIf}
  ${NSD_GetState} $TwRemoveLanguages $0
  ${If} $0 == ${BST_CHECKED}
    RMDir /r "$APPDATA\TeXWeave\languages"
  ${EndIf}
  ${NSD_GetState} $TwRemoveSpellcheck $0
  ${If} $0 == ${BST_CHECKED}
    RMDir /r "$APPDATA\TeXWeave\spellcheck"
  ${EndIf}
  ${NSD_GetState} $TwRemoveTemplates $0
  ${If} $0 == ${BST_CHECKED}
    RMDir /r "$APPDATA\TeXWeave\templates"
  ${EndIf}
  ${NSD_GetState} $TwRemoveCache $0
  ${If} $0 == ${BST_CHECKED}
    RMDir /r "$APPDATA\TeXWeave\cache"
  ${EndIf}
!macroend
!else
!macro customUnInstall
  ; Never remove $APPDATA\TeXWeave here. The standard uninstaller removes the
  ; application directory and shortcuts only because deleteAppDataOnUninstall
  ; is disabled in package.json.
!macroend
!endif
