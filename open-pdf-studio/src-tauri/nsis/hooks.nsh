!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var VPrinterCheckbox
Var VPrinterState
Var AssocPDFCheckbox
Var AssocPDFState
Var DesktopShortcutCheckbox
Var DesktopShortcutState

; Options page - Create
Function VPrinterPageCreate
  ; Skip in passive/update mode
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ; Default to checked for passive/update installs
    StrCpy $AssocPDFState ${BST_CHECKED}
    StrCpy $DesktopShortcutState ${BST_CHECKED}
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Additional Options" "Configure additional features for ${PRODUCTNAME}."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Select additional options for ${PRODUCTNAME}:"
  Pop $0

  ; File association checkbox
  ${NSD_CreateCheckBox} 10u 35u 100% 12u "Associate .pdf files with ${PRODUCTNAME}"
  Pop $AssocPDFCheckbox
  ${NSD_SetState} $AssocPDFCheckbox ${BST_CHECKED}

  ${NSD_CreateLabel} 25u 52u 100% 20u "Double-clicking a PDF file will open it in this application.$\n(You can change this later in Windows Settings.)"
  Pop $0

  ; Virtual printer checkbox
  ${NSD_CreateCheckBox} 10u 82u 100% 12u "Install as virtual printer (print to PDF from any application)"
  Pop $VPrinterCheckbox
  ${NSD_SetState} $VPrinterCheckbox ${BST_CHECKED}

  ${NSD_CreateLabel} 25u 99u 100% 36u "Adds 'Open PDF Studio' to your Windows printers list.$\nWhen you print from any application and select this printer,$\na Save As dialog will appear to save the document as PDF."
  Pop $0

  ; Desktop shortcut checkbox
  ${NSD_CreateCheckBox} 10u 145u 100% 12u "Create a desktop shortcut"
  Pop $DesktopShortcutCheckbox
  ${NSD_SetState} $DesktopShortcutCheckbox ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

; Options page - Leave
Function VPrinterPageLeave
  ${NSD_GetState} $VPrinterCheckbox $VPrinterState
  ${NSD_GetState} $AssocPDFCheckbox $AssocPDFState
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutState
FunctionEnd

; Post-install: apply file association and install virtual printer
!macro NSIS_HOOK_POSTINSTALL

  ; --- PDF file association ---
  ${If} $AssocPDFState == ${BST_CHECKED}
    DetailPrint "Setting ${PRODUCTNAME} as default PDF application..."
    ; Write ProgId for our app
    WriteRegStr SHCTX "Software\Classes\OpenPDFStudio.pdf" "" "PDF Document"
    WriteRegStr SHCTX "Software\Classes\OpenPDFStudio.pdf\DefaultIcon" "" "$INSTDIR\file-icon.ico,0"
    WriteRegStr SHCTX "Software\Classes\OpenPDFStudio.pdf\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    ; Associate .pdf extension
    WriteRegStr SHCTX "Software\Classes\.pdf" "" "OpenPDFStudio.pdf"
    ; Notify Windows Shell to refresh
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
    DetailPrint "PDF file association set."
  ${Else}
    DetailPrint "PDF file association skipped by user."
  ${EndIf}

  ; --- Desktop shortcut ---
  ${If} $DesktopShortcutState == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    DetailPrint "Desktop shortcut created."
  ${Else}
    DetailPrint "Desktop shortcut skipped by user."
  ${EndIf}

  ; --- Virtual printer ---
  DetailPrint "Virtual printer state: $VPrinterState (expected: ${BST_CHECKED})"
  ${If} $VPrinterState == ${BST_CHECKED}
    DetailPrint "Installing Open PDF Studio virtual printer..."
    ; First remove any existing printer with the same name
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Remove-Printer -Name 'Open PDF Studio' -ErrorAction SilentlyContinue$\""
    Pop $0
    ; Now add the printer
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Add-Printer -Name 'Open PDF Studio' -DriverName 'Microsoft Print to PDF' -PortName 'PORTPROMPT:'$\""
    Pop $0
    DetailPrint "Add-Printer exit code: $0"
    ${If} $0 == 0
      DetailPrint "Virtual printer installed successfully."
    ${Else}
      DetailPrint "Virtual printer installation failed (exit code: $0)."
    ${EndIf}
  ${Else}
    DetailPrint "Virtual printer installation skipped by user."
  ${EndIf}

!macroend

; Remove virtual printer and clean up file association during uninstall
!macro NSIS_HOOK_PREUNINSTALL

  ; Remove PDF file association if it points to us
  ReadRegStr $R0 SHCTX "Software\Classes\.pdf" ""
  ${If} $R0 == "OpenPDFStudio.pdf"
    DeleteRegValue SHCTX "Software\Classes\.pdf" ""
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\OpenPDFStudio.pdf"
  Delete "$INSTDIR\file-icon.ico"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'

  ; Remove virtual printer
  DetailPrint "Removing Open PDF Studio virtual printer..."
  nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Remove-Printer -Name 'Open PDF Studio' -ErrorAction Stop$\""
  Pop $0
  ${If} $0 == 0
    DetailPrint "Virtual printer removed successfully."
  ${Else}
    DetailPrint "Virtual printer was not found or already removed."
  ${EndIf}

!macroend
