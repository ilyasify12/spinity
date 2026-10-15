; ===========================================================================
;  Spinity installer skin
;  ---------------------------------------------------------------------------
;  Wired up through electron-builder.yml -> nsis.include.
;
;  electron-builder injects this file *before* its own installer.nsi, which
;  matters for two reasons:
;
;    1. The MUI2 defines below are already in place when oneClick.nsh declares
;       the single instfiles page (MUI2 is only included further down).
;    2. MUI_PAGE_CUSTOMFUNCTION_* has to be defined before that page is
;       declared, so it cannot live in the `customHeader` macro.
;
;  Palette values are kept in sync with src/renderer/src/styles.css.
; ===========================================================================

!ifndef ONE_CLICK
  !error "build/installer.nsh targets the one-click installer (nsis.oneClick: true)."
!endif

; On a freshly formatted machine this check is what stops the installer from
; running at all ("Installer integrity check failed"), long before anything is
; installed. Nothing about a local 7z payload needs it, and skipping it is the
; documented workaround (it is the same thing as passing /NCRC by hand).
CRCCheck off

!define SPINITY_BG     "0B0E17"   ; --bg
!define SPINITY_PANEL  "151A26"   ; --bg-elev: header strip fill
!define SPINITY_TEXT   "F2F4FC"   ; --text
!define SPINITY_DIM    "98A0BC"   ; --text-dim

; PBM_SETBARCOLOR / PBM_SETBKCOLOR come from WinMessages.nsh and want
; 0x00BBGGRR. They only take effect when comctl32 v6 is loaded - the generated
; installer manifest does load it (it is what gives NSIS its visual styles), so
; the bar can be repainted to match the app.
!define SPINITY_ACCENT_BGR 0x006BFF   ; #FF6B00 as BGR
!define SPINITY_PANEL_BGR 0x261A15   ; #151A26 as BGR


; --- theme -------------------------------------------------------------------

; MUI2 paints the header band and its labels with these before we get a say, so
; setting them here is all it takes to recolour the whole outer dialog.
;
; Note: MUI_HEADERIMAGE is deliberately NOT defined. It switches the instfiles
; page to modern_headerbmp.exe, a dialog whose controls are numbered 1000-1025 -
; while MUI2's own instfiles code (GetDlgItem 1004/1006/1016/1027, and the
; button placement) is written for modern.exe's numbering. The result is a
; window MUI2 has resized to the small page while its buttons are still laid
; out for the big one, i.e. the Close button ends up off-screen.
!define MUI_BGCOLOR   "${SPINITY_PANEL}"
!define MUI_TEXTCOLOR "${SPINITY_TEXT}"


!macro preInit
  ; The one-click installer is per-user only, which is exactly what removes the
  ; UAC prompt: it never asks for elevation. The flip side is that it cannot
  ; silently replace a machine-wide install left behind by an older wizard build.
  ; Catch that here rather than leaving two copies of Spinity on disk with a
  ; Start-menu entry pointing at the one that no longer receives updates.
  ${if} ${RunningX64}
    SetRegView 64
  ${endif}
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 != ""
  ${andIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
    MessageBox MB_OK|MB_ICONSTOP \
      "Spinity was already installed for all users in:$\r$\n$0$\r$\n$\r$\n\
       Uninstall that copy first (Windows Settings -> Apps -> Spinity), then run this installer again." \
      /SD IDOK
    SetErrorLevel 1
    Quit
  ${endif}
!macroend


!macro customInit
  ; No wizard, no directory page, no "install for all users" choice. If something
  ; still left $INSTDIR unset, fall back to the standard per-user location rather
  ; than failing deep inside the install section.
  ${if} $INSTDIR == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  ${endif}
!macroend


; NOTE: there is deliberately no customCheckAppRunning here.
;
; This used to be overridden with nsProcess::_FindProcess to avoid spawning
; PowerShell. It reported "Spinity is running. Click OK to close it." on a
; machine with nothing running, and blocked the install behind a
; "cannot be closed" retry loop. Measured against the nsProcess.dll that ships
; with electron-builder, that build's contract is inverted relative to its own
; documentation: it pushes 0 for a process that IS running and a non-zero
; value (603) for one that is not.
;
;   explorer.exe   (running)  -> 0
;   chrome.exe     (running)  -> 0
;   Spinity.exe    (stopped)  -> 603
;   zzz-not-real   (stopped)  -> 603
;
; Writing a check against an undocumented and self-contradictory contract means
; shipping the same class of bug again the moment the plugin is swapped. The
; built-in check is better anyway: under PowerShell it matches on the install
; directory rather than the image name (so a stray Spinity.exe elsewhere on the
; disk cannot trigger it), and where PowerShell is missing or restricted it
; falls back to tasklist + findstr from %SYSDIR%, anchored so that
; "Spinity-Setup-<version>.exe" can never match "Spinity.exe".
;
; Deleting the macro is also what makes electron-builder declare the `pid`
; variable it needs, and include getProcessInfo.nsh itself.


!macro customInstall
  ; The previous version is uninstalled by electron-builder before this point,
  ; so all that can survive is a Start-menu folder left by a build that used
  ; menuCategory. Keep the Start menu to exactly one Spinity entry.
  !ifdef MENU_FILENAME
    !insertmacro cleanupOldMenuDirectory
  !else
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MenuDirectory
    ${if} $0 != ""
      RMDir "$SMPROGRAMS\$0"
    ${endif}
  !endif
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; ---------------------------------------------------------------------------
;  The single window the user ever sees
; ---------------------------------------------------------------------------
;
;  MUI2 draws a stock Modern-UI shell: a grey title bar, a grey page and a
;  green progress bar. It exposes exactly two hooks that run at points where
;  the windows we need actually exist, and which one to use matters:
;
;    MUI_CUSTOMFUNCTION_GUIINIT   .onGUIInit. $HWNDPARENT is the OUTER dialog.
;                                The instfiles page has not been created yet,
;                                so nothing inside it can be reached from here.
;                                Only ever runs once, and is never !undef'd.
;
;    MUI_PAGE_CUSTOMFUNCTION_SHOW the page's Show callback. MUI2 has already
;                                done FindWindow for the page dialog and
;                                GetDlgItem for every control on it (1004 bar,
;                                1006 status text, 1016 log, 1027 "Show
;                                details", 1000 title) before calling us, and
;                                $HWNDPARENT is now the PAGE dialog. This is
;                                the only place the page can be restyled.
;                                It is !undef'd after the first use, which is
;                                harmless: one-click installs have one page.
;
;  Both must be !defined before MUI2.nsh is pulled in, and electron-builder
;  includes this file ahead of installer.nsi (which includes MUI2.nsh), so that
;  ordering already holds.
;
;  The Function bodies themselves live in customHeader, which electron-builder
;  expands *after* `!include "MUI2.nsh"`. That is the only place ${WM_SETTEXT},
;  ${SW_HIDE} and LogicLib's ${if} exist.
!define MUI_CUSTOMFUNCTION_GUIINIT spinity.Outer
!define MUI_PAGE_CUSTOMFUNCTION_SHOW spinity.Page

Var /GLOBAL spinity.OuterHwnd
Var /GLOBAL spinity.PageHwnd
Var /GLOBAL spinity.FontTitle
Var /GLOBAL spinity.FontSmall

!macro customHeader
; ---------------------------------------------------------------------------
;  Outer window: title bar, header band, and the one button worth keeping.
; ---------------------------------------------------------------------------
Function spinity.Outer
  ; .onGUIInit passes the outer dialog as $HWNDPARENT. The instfiles page has
  ; not been created yet, so nothing inside it can be reached from here.
  StrCpy $spinity.OuterHwnd $HWNDPARENT

  ; A dialog answers WM_CTLCOLOR*, so this recolours its background and every
  ; label painted straight onto it. MUI2 has already painted the header band
  ; from MUI_BGCOLOR; the individual controls are corrected as well because
  ; their colours are captured from the colour table at init time.
  SetCtlColors $HWNDPARENT "${SPINITY_TEXT}" "${SPINITY_BG}"
  ${if} $mui.Header.Background != 0
    SetCtlColors $mui.Header.Background "" "${SPINITY_BG}"
  ${endif}
  ${if} $mui.Header.Text != 0
    SetCtlColors $mui.Header.Text "${SPINITY_TEXT}" "${SPINITY_BG}"
  ${endif}
  ${if} $mui.Header.SubText != 0
    SetCtlColors $mui.Header.SubText "${SPINITY_DIM}" "${SPINITY_BG}"
  ${endif}
  ${if} $mui.Header.Image != 0
    SetCtlColors $mui.Header.Image "" "${SPINITY_BG}"
  ${endif}

  ; The caption and the buttons are handled in spinity.Page instead: NSIS
  ; re-applies both while it pushes the page, which is after .onGUIInit.
FunctionEnd

; ---------------------------------------------------------------------------
;  Instfiles page: the part that actually does the work.
; ---------------------------------------------------------------------------
Function spinity.Page
  ; $HWNDPARENT is the OUTER dialog here too - NSIS page callbacks always get
  ; the main window. The page is a separate dialog parented to it, which is why
  ; every control id below comes back MISSING against $HWNDPARENT directly.
  ; MUI2 reaches it the same way.
  FindWindow $spinity.PageHwnd "#32770" "" $HWNDPARENT
  ${if} $spinity.PageHwnd == 0
    Return
  ${endif}

  ; --- the restyling -------------------------------------------------------
  ; MUI2 puts `Caption " "` on this page, so the stock window has a blank title
  ; bar. It re-applies the caption while it pushes the page - i.e. after
  ; .onGUIInit - so this has to be set here, from the later hook.
  SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "Spinity Setup"

  ; NSIS renames "Next" to "Close" on the last page, which leaves two buttons
  ; that both just close the window. One is enough.
  ${if} $mui.Button.Next != 0
    ShowWindow $mui.Button.Next ${SW_HIDE}
  ${endif}
  ${if} $mui.Button.Back != 0
    ShowWindow $mui.Button.Back ${SW_HIDE}
  ${endif}
  ${if} $mui.Button.Cancel != 0
    SendMessage $mui.Button.Cancel ${WM_SETTEXT} 0 "Close"
  ${endif}

  SetCtlColors $spinity.PageHwnd "${SPINITY_TEXT}" "${SPINITY_BG}"

  ; A two-second install has nothing worth expanding into, and "Show details"
  ; opening a log nobody asked for is the oldest-looking thing on the page.
  GetDlgItem $0 $spinity.PageHwnd 1027
  ${if} $0 != 0
    ShowWindow $0 ${SW_HIDE}
  ${endif}
  GetDlgItem $0 $spinity.PageHwnd 1016
  ${if} $0 != 0
    ShowWindow $0 ${SW_HIDE}
  ${endif}

  ; 1000 carries MUI2's own progress sentence, not a heading: keep it quiet.
  GetDlgItem $0 $spinity.PageHwnd 1000
  ${if} $0 != 0
    CreateFont $spinity.FontSmall "Segoe UI" 8
    ${if} $spinity.FontSmall != 0
      SendMessage $0 ${WM_SETFONT} $spinity.FontSmall 0
    ${endif}
    SetCtlColors $0 "${SPINITY_DIM}" "${SPINITY_BG}"
  ${endif}

  ; 1006 is the status line, the one thing the user actually reads.
  GetDlgItem $0 $spinity.PageHwnd 1006
  ${if} $0 != 0
    CreateFont $spinity.FontTitle "Segoe UI Semibold" 10
    ${if} $spinity.FontTitle != 0
      SendMessage $0 ${WM_SETFONT} $spinity.FontTitle 0
    ${endif}
    SetCtlColors $0 "${SPINITY_TEXT}" "${SPINITY_BG}"
  ${endif}

  ; Stock MUI2 leaves the bar in whatever the system accent happens to be - the
  ; one colour on screen that belongs to no design at all.
  ;
  ; PBM_SETBKCOLOR / PBM_SETBARCOLOR take the COLORREF in *wParam* and 0 in
  ; lParam. Passing it as lParam looks like it works - the bar is still themed,
  ; just in the system accent rather than in ours.
  GetDlgItem $0 $spinity.PageHwnd 1004
  ${if} $0 != 0
    SendMessage $0 ${PBM_SETBKCOLOR} ${SPINITY_PANEL_BGR} 0
    SendMessage $0 ${PBM_SETBARCOLOR} ${SPINITY_ACCENT_BGR} 0
  ${endif}
FunctionEnd
!macroend
