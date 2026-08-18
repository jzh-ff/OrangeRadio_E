!ifndef MUI_BGCOLOR
  !define MUI_BGCOLOR "14100A"
!endif
!ifndef MUI_TEXTCOLOR
  !define MUI_TEXTCOLOR "F5F0E6"
!endif
!ifndef MUI_DIRECTORYPAGE_BGCOLOR
  !define MUI_DIRECTORYPAGE_BGCOLOR "14100A"
!endif
!ifndef MUI_DIRECTORYPAGE_TEXTCOLOR
  !define MUI_DIRECTORYPAGE_TEXTCOLOR "F5F0E6"
!endif
!ifndef MUI_INSTFILESPAGE_COLORS
  !define MUI_INSTFILESPAGE_COLORS "FF7A3D 14100A"
!endif
!ifndef MUI_FINISHPAGE_LINK_COLOR
  !define MUI_FINISHPAGE_LINK_COLOR "FF7A3D"
!endif
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_BITMAP_STRETCH
  !define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!endif
!ifndef MUI_HEADERIMAGE_UNBITMAP_STRETCH
  !define MUI_HEADERIMAGE_UNBITMAP_STRETCH "FitControl"
!endif
!ifndef BUILD_UNINSTALLER
  !ifndef MUI_CUSTOMFUNCTION_GUIINIT
    !define MUI_CUSTOMFUNCTION_GUIINIT MineradioGuiInit
  !endif
!endif

!include LogicLib.nsh
!include FileFunc.nsh
!include StdUtils.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!ifndef MINERADIO_INSTALL_DIR_NAME
  !define MINERADIO_INSTALL_DIR_NAME "OrangeSea"
!endif
!ifndef MINERADIO_INSTALL_DIR_NAME_LOWER
  !define MINERADIO_INSTALL_DIR_NAME_LOWER "orangesea"
!endif
!ifndef MINERADIO_INSTALL_MARKER
  !define MINERADIO_INSTALL_MARKER ".orangesea-install-root"
!endif
!ifndef MINERADIO_MARKER_APP_ID
  !define MINERADIO_MARKER_APP_ID "com.orangesea.desktop"
!endif
!ifndef MINERADIO_INSTALL_BRAND
  !define MINERADIO_INSTALL_BRAND "ORANGESEA"
!endif
!ifndef MINERADIO_INSTALL_TITLE
  !define MINERADIO_INSTALL_TITLE "OrangeSea 安装"
!endif
!ifndef MINERADIO_INSTALL_NOTICE
  !define MINERADIO_INSTALL_NOTICE ""
!endif

; ── 卸载反馈页 ─────────────────────────────────────────────────────────────
; 卸载向导第一页是"反馈页"（建议/卸载原因 + 联系方式），填写后 POST JSON 到下方端点，
; 由自建接收器转发到开发者邮箱 1226163446@qq.com；发送失败会询问是否打开网页表单兜底，
; 绝不阻塞卸载。
; 关闭状态（默认）：保持下面这行注释，卸载器使用 electron-builder 默认欢迎页，行为与旧版一致。
; 开启方法：部署 tools/uninstall-feedback-server/ 到云服务器（见其 README，含 QQ 邮箱 SMTP
;           配置），把对外地址（形如 https://你的域名/feedback）取消注释填入，重新打包。
;           端点要求：POST JSON 返回 2xx；GET 返回网页表单（接收器两者都内置）。
; 安全边界：SMTP 授权码只放服务器环境变量，绝不进安装包（安装包可被解包提取授权码）；
;           也不可用 Formspree/formsubmit/web3forms 等表单服务——实测均拒绝服务端调用。
!define MINERADIO_FEEDBACK_ENDPOINT "http://82.156.224.145:8787/feedback"

; 卸载器暗色外观钩子：必须放在端点 define 之后、MUI 页面插入之前
!ifdef BUILD_UNINSTALLER
  !ifdef MINERADIO_FEEDBACK_ENDPOINT
    !ifndef MUI_CUSTOMFUNCTION_UNGUIINIT
      !define MUI_CUSTOMFUNCTION_UNGUIINIT un.MineradioUnGuiInit
    !endif
  !endif
!endif

!ifndef BUILD_UNINSTALLER
  Var MineradioWelcomePage
  Var MineradioHeroFont
  Var MineradioTitleFont
  Var MineradioBodyFont
  Var MineradioSmallFont
  Var MineradioDirectoryPage
  Var MineradioDirectoryInput
!endif

!ifndef BUILD_UNINSTALLER
; DPI 感知: 尽早声明, 避免 NSIS 窗口被 Windows 位图拉伸导致字体模糊
Function MineradioEnableDpiAwareness
  System::Call 'user32::SetProcessDpiAwarenessContext(p -4) i .r0'
  ${If} $0 == 0
    System::Call 'shcore::SetProcessDpiAwareness(i 2) i .r0'
  ${EndIf}
  ${If} $0 == 0
    System::Call 'user32::SetProcessDPIAware() i .r0'
  ${EndIf}
FunctionEnd
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call MineradioEnableDpiAwareness
    Call MineradioUsePreferredInstallDir
    Call MineradioDisableUnsafeOldUninstallers
    ${If} ${Silent}
      Call MineradioValidateInstallDir
    ${EndIf}
  !endif
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\${MINERADIO_INSTALL_MARKER}" w
  ${IfNot} ${Errors}
    FileWrite $0 "OrangeSea install root$\r$\n"
    FileWrite $0 "appId=${MINERADIO_MARKER_APP_ID}$\r$\n"
    FileClose $0
  ${EndIf}
!macroend

!macro customRemoveFiles
  Call un.MineradioRemoveInstalledFiles
!macroend

!macro customWelcomePage
  Page custom MineradioWelcomeShow
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom MineradioDirectoryShow MineradioDirectoryLeave
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function MineradioFinishStartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "MineradioFinishStartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MineradioTintCommonControls
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function MineradioGuiInit
  Call MineradioEnableDpiAwareness
  ; 暗色标题栏 (DWMWA_USE_IMMERSIVE_DARKMODE=20, DWMWA_CAPTION_COLOR=35 on newer builds)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call MineradioTintCommonControls
FunctionEnd

Function MineradioTintCommonControls
  SetCtlColors $HWNDPARENT "F5F0E6" "14100A"

  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1028
  ${If} $0 <> 0
    SetCtlColors $0 "C9A87A" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    SetCtlColors $0 "C9A87A" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  ${If} $0 <> 0
    SetCtlColors $0 "" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1035
  ${If} $0 <> 0
    SetCtlColors $0 "" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 <> 0
    SetCtlColors $0 "C9A87A" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1039
  ${If} $0 <> 0
    SetCtlColors $0 "" "14100A"
  ${EndIf}

  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"

    GetDlgItem $1 $0 1000
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1001
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1004
    ${If} $1 <> 0
      SetCtlColors $1 "FF7A3D" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1006
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1016
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1019
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1020
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1023
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1024
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1027
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1201
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1202
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1203
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1204
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function MineradioUsePreferredInstallDir
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/D=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 != ""
    StrCpy $INSTDIR "$R1"
  ${Else}
    Call MineradioUseRegisteredInstallDir
    Pop $R2
    ${If} $R2 != "1"
      Call MineradioUseFirstAvailableInstallDir
    ${EndIf}
  ${EndIf}
  Push "$INSTDIR"
  Call MineradioNormalizeInstallDir
  Pop $INSTDIR
FunctionEnd

Function MineradioUseFirstAvailableInstallDir
  IfFileExists "D:\*.*" driveD 0
  IfFileExists "E:\*.*" driveE 0
  IfFileExists "F:\*.*" driveF 0
  IfFileExists "G:\*.*" driveG 0
  IfFileExists "H:\*.*" driveH 0
  IfFileExists "I:\*.*" driveI 0
  IfFileExists "J:\*.*" driveJ 0
  IfFileExists "K:\*.*" driveK 0
  IfFileExists "L:\*.*" driveL 0
  IfFileExists "M:\*.*" driveM 0
  IfFileExists "N:\*.*" driveN 0
  IfFileExists "O:\*.*" driveO 0
  IfFileExists "P:\*.*" driveP 0
  IfFileExists "Q:\*.*" driveQ 0
  IfFileExists "R:\*.*" driveR 0
  IfFileExists "S:\*.*" driveS 0
  IfFileExists "T:\*.*" driveT 0
  IfFileExists "U:\*.*" driveU 0
  IfFileExists "V:\*.*" driveV 0
  IfFileExists "W:\*.*" driveW 0
  IfFileExists "X:\*.*" driveX 0
  IfFileExists "Y:\*.*" driveY 0
  IfFileExists "Z:\*.*" driveZ 0
  StrCpy $INSTDIR "C:\${MINERADIO_INSTALL_DIR_NAME}"
  Return

  driveD:
    StrCpy $INSTDIR "D:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveE:
    StrCpy $INSTDIR "E:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveF:
    StrCpy $INSTDIR "F:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveG:
    StrCpy $INSTDIR "G:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveH:
    StrCpy $INSTDIR "H:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveI:
    StrCpy $INSTDIR "I:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveJ:
    StrCpy $INSTDIR "J:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveK:
    StrCpy $INSTDIR "K:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveL:
    StrCpy $INSTDIR "L:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveM:
    StrCpy $INSTDIR "M:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveN:
    StrCpy $INSTDIR "N:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveO:
    StrCpy $INSTDIR "O:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveP:
    StrCpy $INSTDIR "P:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveQ:
    StrCpy $INSTDIR "Q:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveR:
    StrCpy $INSTDIR "R:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveS:
    StrCpy $INSTDIR "S:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveT:
    StrCpy $INSTDIR "T:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveU:
    StrCpy $INSTDIR "U:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveV:
    StrCpy $INSTDIR "V:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveW:
    StrCpy $INSTDIR "W:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveX:
    StrCpy $INSTDIR "X:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveY:
    StrCpy $INSTDIR "Y:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
  driveZ:
    StrCpy $INSTDIR "Z:\${MINERADIO_INSTALL_DIR_NAME}"
    Return
FunctionEnd

Function MineradioHasPreferredInstallDrive
  IfFileExists "D:\*.*" hasPreferred 0
  IfFileExists "E:\*.*" hasPreferred 0
  IfFileExists "F:\*.*" hasPreferred 0
  IfFileExists "G:\*.*" hasPreferred 0
  IfFileExists "H:\*.*" hasPreferred 0
  IfFileExists "I:\*.*" hasPreferred 0
  IfFileExists "J:\*.*" hasPreferred 0
  IfFileExists "K:\*.*" hasPreferred 0
  IfFileExists "L:\*.*" hasPreferred 0
  IfFileExists "M:\*.*" hasPreferred 0
  IfFileExists "N:\*.*" hasPreferred 0
  IfFileExists "O:\*.*" hasPreferred 0
  IfFileExists "P:\*.*" hasPreferred 0
  IfFileExists "Q:\*.*" hasPreferred 0
  IfFileExists "R:\*.*" hasPreferred 0
  IfFileExists "S:\*.*" hasPreferred 0
  IfFileExists "T:\*.*" hasPreferred 0
  IfFileExists "U:\*.*" hasPreferred 0
  IfFileExists "V:\*.*" hasPreferred 0
  IfFileExists "W:\*.*" hasPreferred 0
  IfFileExists "X:\*.*" hasPreferred 0
  IfFileExists "Y:\*.*" hasPreferred 0
  IfFileExists "Z:\*.*" hasPreferred 0
  Push "0"
  Return

  hasPreferred:
    Push "1"
    Return
FunctionEnd

Function MineradioNormalizeInstallDir
  Exch $0
  Push "$0"
  Call MineradioTrimInstallDir
  Pop $0
  StrLen $4 "${MINERADIO_INSTALL_DIR_NAME}"
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\${MINERADIO_INSTALL_DIR_NAME}"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0${MINERADIO_INSTALL_DIR_NAME}"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  IntOp $5 $4 + 1
  StrCpy $2 "$0" $5 -$5
  ${If} $1 < $5
  ${OrIf} $2 != "\${MINERADIO_INSTALL_DIR_NAME}"
  ${AndIf} $2 != "\${MINERADIO_INSTALL_DIR_NAME_LOWER}"
    StrCpy $0 "$0\${MINERADIO_INSTALL_DIR_NAME}"
  ${EndIf}
  Exch $0
FunctionEnd

Function MineradioTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function MineradioInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${MINERADIO_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function MineradioExistingInstallPathCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call MineradioTrimInstallDir
  Pop $2
  ${If} $2 == ""
    Goto done
  ${EndIf}

  Push "$2"
  Call MineradioNormalizeInstallDir
  Pop $3
  ${If} $2 != $3
    Goto done
  ${EndIf}

  IfFileExists "$2\*.*" 0 done
  IfFileExists "$2\${MINERADIO_INSTALL_MARKER}" adopt 0
  IfFileExists "$2\${PRODUCT_FILENAME}.exe" adopt 0
  IfFileExists "$2\resources\app.asar" adopt 0
  IfFileExists "$2\resources\app\package.json" adopt 0
  IfFileExists "$2\resources\app\server.js" adopt 0
  Goto done

  adopt:
    StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function MineradioUseRegisteredInstallDir
  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  Push "0"
FunctionEnd

Function MineradioRegisteredInstallDirCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call MineradioNormalizeInstallDir
  Pop $2

  ReadRegStr $3 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call MineradioNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function MineradioInstallDirIsEmpty
  Exch $0
  FindFirst $1 $2 "$0\*.*"
  StrCpy $3 "1"

  loop:
    StrCmp $2 "" done
    StrCmp $2 "." next
    StrCmp $2 ".." next
    StrCpy $3 "0"
    Goto done

  next:
    FindNext $1 $2
    Goto loop

  done:
    FindClose $1
    StrCpy $0 "$3"
    Exch $0
FunctionEnd

Function MineradioOldInstallPathNeedsQuarantine
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call MineradioTrimInstallDir
  Pop $2
  Push "$2"
  Call MineradioNormalizeInstallDir
  Pop $3

  ${If} $2 != $3
    StrCpy $1 "1"
    Goto done
  ${EndIf}

  IfFileExists "$2\${MINERADIO_INSTALL_MARKER}" done 0
  Push "$2"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Goto done
  ${EndIf}

  StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function MineradioDisableUnsafeOldUninstallers
  StrCpy $2 "0"

  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy OrangeSea uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy OrangeSea uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKCU "Software\${APP_GUID}"
  ${EndIf}

  StrCpy $2 "0"

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy OrangeSea uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call MineradioOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy OrangeSea uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\${APP_GUID}"
  ${EndIf}
FunctionEnd

Function MineradioDeleteLegacyUninstallerFileIfMissingMarker
  Pop $0
  ${If} $0 != ""
    Push "$0"
    Call MineradioTrimInstallDir
    Pop $1
    ${If} $1 != ""
      IfFileExists "$1\${MINERADIO_INSTALL_MARKER}" done 0
      DetailPrint "Remove legacy OrangeSea uninstaller file: $1"
      Delete "$1\Uninstall ${PRODUCT_FILENAME}.exe"
    ${EndIf}
  ${EndIf}

  done:
FunctionEnd

Function MineradioValidateInstallDir
  Push "$INSTDIR"
  Call MineradioNormalizeInstallDir
  Pop $INSTDIR

  Push "$INSTDIR"
  Call MineradioRegisteredInstallDirCanBeAdopted
  Pop $3

  Push "$INSTDIR"
  Call MineradioExistingInstallPathCanBeAdopted
  Pop $4

  StrCpy $0 "$INSTDIR" 1 0
  StrCpy $1 "$INSTDIR" 1 1
  ${If} $1 == ":"
    ${If} $0 == "C"
    ${OrIf} $0 == "c"
      Call MineradioHasPreferredInstallDrive
      Pop $2
      ${If} $2 == "1"
      ${AndIf} $3 != "1"
      ${AndIf} $4 != "1"
        MessageBox MB_ICONSTOP|MB_OK "检测到这台电脑还有 D-Z 盘，OrangeSea 不安装到 C 盘。请改选 D 盘或其它非 C 盘的 OrangeSea 文件夹。$\r$\n$\r$\n如果电脑只有 C 盘，安装器会自动放行 C:\OrangeSea。"
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}

  StrLen $0 "$INSTDIR"
  StrLen $2 "${MINERADIO_INSTALL_DIR_NAME}"
  IntOp $2 $2 + 1
  StrCpy $1 "$INSTDIR" $2 -$2
  ${If} $0 < $2
  ${OrIf} $1 != "\${MINERADIO_INSTALL_DIR_NAME}"
  ${AndIf} $1 != "\${MINERADIO_INSTALL_DIR_NAME_LOWER}"
    MessageBox MB_ICONSTOP|MB_OK "安装目录必须是独立的 OrangeSea 文件夹。请选择一个上级目录，安装器会自动创建 OrangeSea 子文件夹。"
    Abort
  ${EndIf}

  IfFileExists "$INSTDIR\*.*" 0 valid

  Push "$INSTDIR"
  Call MineradioInstallDirLooksOwned
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  ${If} $3 == "1"
    Goto valid
  ${EndIf}

  ${If} $4 == "1"
    Goto valid
  ${EndIf}

  Push "$INSTDIR"
  Call MineradioInstallDirIsEmpty
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "为避免卸载时误删其它文件，OrangeSea 不能安装到已有文件的非专属目录。请新建或选择一个空的 OrangeSea 文件夹。$\r$\n$\r$\n当前路径：$INSTDIR"
  Abort

  valid:
FunctionEnd
Function MineradioWelcomeShow
  Call MineradioUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $MineradioWelcomePage
  ${If} $MineradioWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $MineradioWelcomePage "F5F0E6" "14100A"
  CreateFont $MineradioHeroFont "Microsoft YaHei UI" 24 700
  CreateFont $MineradioTitleFont "Microsoft YaHei UI" 10 700
  CreateFont $MineradioBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $MineradioSmallFont "Microsoft YaHei UI" 8 400

  ; 品牌标记 (顶部小字, 橙色)
  ${NSD_CreateLabel} 20u 10u 200u 10u "${MINERADIO_INSTALL_BRAND}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  SetCtlColors $0 "FF7A3D" "14100A"

  ; Hero 标题 (大字, 米白)
  ${NSD_CreateLabel} 20u 26u 270u 30u "${MINERADIO_INSTALL_TITLE}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioHeroFont 1
  SetCtlColors $0 "F5F0E6" "14100A"

  ; 橙色分隔线
  ${NSD_CreateLabel} 20u 60u 44u 2u ""
  Pop $0
  SetCtlColors $0 "" "FF7A3D"

  ; 介绍文案 (正文, 暖金)
  ${NSD_CreateLabel} 20u 70u 270u 28u "日落时分，海面橙红。OrangeSea 把音乐变成一场私人日落——粒子舞台、3D 歌词、胶片电台，让每一首歌都有画面。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioBodyFont 1
  SetCtlColors $0 "C9A87A" "14100A"

  ; 默认安装路径 (橙色强调)
  ${NSD_CreateLabel} 20u 108u 270u 14u "默认安装到 $INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioTitleFont 1
  SetCtlColors $0 "FF7A3D" "14100A"

  !ifdef MINERADIO_INTERNAL_BETA
    ${NSD_CreateLabel} 20u 126u 268u 24u "${MINERADIO_INSTALL_NOTICE}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
    SetCtlColors $0 "FF5E62" "14100A"
  !endif

  nsDialogs::Show
FunctionEnd

Function MineradioDirectoryBrowse
  nsDialogs::SelectFolderDialog "选择 ${PRODUCT_NAME} 安装文件夹" "$INSTDIR"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    Push "$0"
    Call MineradioNormalizeInstallDir
    Pop $0
    StrCpy $INSTDIR "$0"
    SendMessage $MineradioDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  ${EndIf}
FunctionEnd

Function MineradioDirectoryShow
  Call MineradioUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $MineradioDirectoryPage
  ${If} $MineradioDirectoryPage == error
    Abort
  ${EndIf}

  SetCtlColors $MineradioDirectoryPage "F5F0E6" "14100A"
  CreateFont $MineradioTitleFont "Microsoft YaHei UI" 14 700
  CreateFont $MineradioBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $MineradioSmallFont "Microsoft YaHei UI" 8 500

  ; 页面标题
  ${NSD_CreateLabel} 20u 8u 260u 16u "选择安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioTitleFont 1
  SetCtlColors $0 "F5F0E6" "14100A"

  ; 说明文案 (紧凑, 控制在 2 行内)
  ${NSD_CreateLabel} 20u 30u 260u 26u "选一个你喜欢的地方安放 OrangeSea，默认推荐 D 盘，也可以浏览其它位置。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioBodyFont 1
  SetCtlColors $0 "C9A87A" "14100A"

  ; 安装目录标签
  ${NSD_CreateLabel} 20u 62u 260u 10u "安装目录"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  SetCtlColors $0 "FF7A3D" "14100A"

  ; 路径输入框
  ${NSD_CreateText} 20u 76u 190u 14u "$INSTDIR"
  Pop $MineradioDirectoryInput
  SendMessage $MineradioDirectoryInput ${WM_SETFONT} $MineradioBodyFont 1
  SetCtlColors $MineradioDirectoryInput "14100A" "F5F0E6"

  ; 浏览按钮
  ${NSD_CreateBrowseButton} 220u 75u 54u 16u "浏览..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  ${NSD_OnClick} $0 MineradioDirectoryBrowse

  ; 底部提示
  ${NSD_CreateLabel} 20u 100u 260u 20u "推荐 D:\${MINERADIO_INSTALL_DIR_NAME}，选盘符会自动建文件夹。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioSmallFont 1
  SetCtlColors $0 "8A7A5C" "14100A"

  nsDialogs::Show
FunctionEnd

Function MineradioDirectoryLeave
  ${NSD_GetText} $MineradioDirectoryInput $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装文件夹。"
    Abort
  ${EndIf}
  Push "$0"
  Call MineradioNormalizeInstallDir
  Pop $0
  StrCpy $INSTDIR "$0"
  SendMessage $MineradioDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  Call MineradioValidateInstallDir
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInit
  !ifdef MINERADIO_FEEDBACK_ENDPOINT
    ; 反馈页启用时必须在卸载器窗口创建前声明 DPI 感知（与安装器 customInit 同款时序），
    ; 放在 un.onGUIInit 会因窗口已按非感知上下文创建而整体缩小成 96DPI 物理像素
    Call un.MineradioEnableDpiAwareness
  !endif
  Call un.MineradioValidateUninstallDir
!macroend

Function un.MineradioInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${MINERADIO_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function un.MineradioNormalizeInstallDir
  Exch $0
  Push "$0"
  Call un.MineradioTrimInstallDir
  Pop $0
  StrLen $4 "${MINERADIO_INSTALL_DIR_NAME}"
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\${MINERADIO_INSTALL_DIR_NAME}"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0${MINERADIO_INSTALL_DIR_NAME}"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  IntOp $5 $4 + 1
  StrCpy $2 "$0" $5 -$5
  ${If} $1 < $5
  ${OrIf} $2 != "\${MINERADIO_INSTALL_DIR_NAME}"
  ${AndIf} $2 != "\${MINERADIO_INSTALL_DIR_NAME_LOWER}"
    StrCpy $0 "$0\${MINERADIO_INSTALL_DIR_NAME}"
  ${EndIf}
  Exch $0
FunctionEnd

Function un.MineradioTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function un.MineradioValidateUninstallDir
  Push "$INSTDIR"
  Call un.MineradioTrimInstallDir
  Pop $0
  Push "$0"
  Call un.MineradioNormalizeInstallDir
  Pop $1
  ${If} $0 != $1
    MessageBox MB_OK|MB_ICONSTOP "当前卸载路径不是 OrangeSea 专属目录，已阻止卸载以避免误删其它文件。$\r$\n$\r$\n当前路径：$INSTDIR$\r$\n安全路径应为：$0"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $INSTDIR "$0"

  Push "$INSTDIR"
  Call un.MineradioInstallDirLooksOwned
  Pop $0
  ${If} $0 != "1"
    MessageBox MB_OK|MB_ICONSTOP "无法确认当前目录属于 OrangeSea，已阻止卸载以避免误删其它文件。$\r$\n$\r$\n当前路径：$INSTDIR"
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function un.MineradioRemoveInstalledFiles
  SetOutPath $TEMP

  Delete "$INSTDIR\${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\uninstallerIcon.ico"

  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"

  RMDir "$INSTDIR\locales"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR\swiftshader"

  RMDir "$INSTDIR"
FunctionEnd
!endif

; ═══════════════════════════ 卸载反馈页 ═══════════════════════════
; 仅在定义了 MINERADIO_FEEDBACK_ENDPOINT 时编入卸载器：
; 作为卸载向导第一页（替换默认英文欢迎页），收集建议/联系方式，
; 通过系统自带 PowerShell POST JSON 到端点（Formspree 转发到开发者邮箱）。
; 用户文本只经临时 UTF-16 文件传递，绝不拼进命令行（防注入/防编码错乱）。
!ifdef BUILD_UNINSTALLER
!ifdef MINERADIO_FEEDBACK_ENDPOINT

!macro customUnWelcomePage
  UninstPage custom un.MineradioFeedbackShow un.MineradioFeedbackLeave
!macroend

Var MineradioUnFeedbackDialog
Var MineradioUnFeedbackText
Var MineradioUnFeedbackContact
Var MineradioUnTitleFont
Var MineradioUnBodyFont
Var MineradioUnSmallFont

!ifndef EM_SETCUEBANNER
  !define EM_SETCUEBANNER 0x1501
!endif

; 逐行写入反馈发送脚本（纯 ASCII，用户文本不进入脚本）
!macro MineradioUnFeedbackWriteLine HANDLE TEXT
  FileWrite ${HANDLE} "${TEXT}$\r$\n"
!macroend

Function un.MineradioEnableDpiAwareness
  System::Call 'user32::SetProcessDpiAwarenessContext(p -4) i .r0'
  ${If} $0 == 0
    System::Call 'shcore::SetProcessDpiAwareness(i 2) i .r0'
  ${EndIf}
  ${If} $0 == 0
    System::Call 'user32::SetProcessDPIAware() i .r0'
  ${EndIf}
FunctionEnd

Function un.MineradioTintCommonControls
  SetCtlColors $HWNDPARENT "F5F0E6" "14100A"

  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 <> 0
    SetCtlColors $0 "C9A87A" "14100A"
  ${EndIf}

  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    SetCtlColors $0 "F5F0E6" "14100A"

    GetDlgItem $1 $0 1000
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1001
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1004
    ${If} $1 <> 0
      SetCtlColors $1 "FF7A3D" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1006
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1016
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1019
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1020
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1023
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1024
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1027
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1201
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1202
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1203
    ${If} $1 <> 0
      SetCtlColors $1 "F5F0E6" "14100A"
    ${EndIf}
    GetDlgItem $1 $0 1204
    ${If} $1 <> 0
      SetCtlColors $1 "C9A87A" "14100A"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.MineradioUnGuiInit
  ; 暗色标题栏 (DWMWA_USE_IMMERSIVE_DARKMODE=20, DWMWA_CAPTION_COLOR=19)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call un.MineradioTintCommonControls
FunctionEnd

; 去掉 $9 首尾空白/换行，并截断到 NSIS 字符串安全长度
Function un.MineradioFeedbackTrim
  Exch $9

  trim_head:
    StrLen $8 "$9"
    StrCmp $8 0 trim_done
    StrCpy $7 "$9" 1 0
    StrCmp $7 " " cut_head
    StrCmp $7 "$\t" cut_head
    StrCmp $7 "$\r" cut_head
    StrCmp $7 "$\n" cut_head
    Goto trim_tail

  cut_head:
    StrCpy $9 "$9" "" 1
    Goto trim_head

  trim_tail:
    StrLen $8 "$9"
    StrCmp $8 0 trim_done
    StrCpy $7 "$9" 1 -1
    StrCmp $7 " " cut_tail
    StrCmp $7 "$\t" cut_tail
    StrCmp $7 "$\r" cut_tail
    StrCmp $7 "$\n" cut_tail
    Goto trim_done

  cut_tail:
    StrCpy $9 "$9" -1
    Goto trim_tail

  trim_done:
    StrCpy $9 "$9" 1024

  Exch $9
FunctionEnd

Function un.MineradioFeedbackShow
  ; 静默卸载（含升级覆盖安装）不显示反馈页
  ${If} ${Silent}
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $MineradioUnFeedbackDialog
  ${If} $MineradioUnFeedbackDialog == error
    Abort
  ${EndIf}

  SetCtlColors $MineradioUnFeedbackDialog "F5F0E6" "14100A"
  CreateFont $MineradioUnTitleFont "Microsoft YaHei UI" 14 700
  CreateFont $MineradioUnBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $MineradioUnSmallFont "Microsoft YaHei UI" 8 400

  ; 品牌标记（顶部小字，橙色）
  ${NSD_CreateLabel} 20u 5u 200u 9u "${MINERADIO_INSTALL_BRAND}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioUnSmallFont 1
  SetCtlColors $0 "FF7A3D" "14100A"

  ; 页面标题
  ${NSD_CreateLabel} 20u 17u 268u 16u "要和 OrangeSea 说再见了吗？"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioUnTitleFont 1
  SetCtlColors $0 "F5F0E6" "14100A"

  ; 橙色分隔线
  ${NSD_CreateLabel} 20u 36u 44u 2u ""
  Pop $0
  SetCtlColors $0 "" "FF7A3D"

  ; 说明文案（含隐私说明，可全部留空跳过）
  ${NSD_CreateLabel} 20u 44u 268u 30u "如果哪里做得不好，或想留下建议，欢迎告诉开发者；也可以留个 QQ / 邮箱方便回复。内容会发送到开发者邮箱，仅用于改进 OrangeSea；全部留空则直接继续卸载。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioUnBodyFont 1
  SetCtlColors $0 "C9A87A" "14100A"

  ; 建议 / 卸载原因
  ${NSD_CreateLabel} 20u 78u 200u 10u "建议 / 卸载原因（可选）"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $MineradioUnSmallFont 1
  SetCtlColors $0 "FF7A3D" "14100A"

  ; 注意：CreateControl 的样式参数只接受数值串（nsDialogs.nsh 已将 WS_*/ES_* 定义为数值），
  ; 直接写标志名会导致插件解析失败、控件不创建
  nsDialogs::CreateControl "EDIT" "${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS}|${WS_TABSTOP}|${ES_MULTILINE}|${ES_WANTRETURN}|${WS_VSCROLL}|${ES_AUTOVSCROLL}" "${WS_EX_WINDOWEDGE}|${WS_EX_CLIENTEDGE}" 20u 90u 268u 32u ""
  Pop $MineradioUnFeedbackText
  SendMessage $MineradioUnFeedbackText ${WM_SETFONT} $MineradioUnBodyFont 1
  SetCtlColors $MineradioUnFeedbackText "14100A" "F5F0E6"

  ; 联系方式（单行，灰字提示）
  ${NSD_CreateText} 20u 126u 268u 13u ""
  Pop $MineradioUnFeedbackContact
  SendMessage $MineradioUnFeedbackContact ${WM_SETFONT} $MineradioUnBodyFont 1
  SetCtlColors $MineradioUnFeedbackContact "14100A" "F5F0E6"
  SendMessage $MineradioUnFeedbackContact ${EM_SETCUEBANNER} 1 "STR:联系方式（可选）：QQ / 邮箱"

  nsDialogs::Show
FunctionEnd

Function un.MineradioFeedbackLeave
  ${NSD_GetText} $MineradioUnFeedbackText $0
  Push $0
  Call un.MineradioFeedbackTrim
  Pop $0

  ${NSD_GetText} $MineradioUnFeedbackContact $1
  Push $1
  Call un.MineradioFeedbackTrim
  Pop $1

  ; 全部留空 = 直接继续卸载
  ${If} $0 == ""
  ${AndIf} $1 == ""
    Return
  ${EndIf}

  ; 附加应用版本（卸载注册表，per-user 安装）
  ReadRegStr $2 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" DisplayVersion
  ${If} $2 == ""
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" DisplayVersion
  ${EndIf}
  ${If} $2 == ""
    StrCpy $2 "unknown"
  ${EndIf}

  StrCpy $3 "$TEMP\orangesea-uninstall-feedback.txt"
  StrCpy $4 "$TEMP\orangesea-uninstall-contact.txt"
  StrCpy $5 "$TEMP\orangesea-uninstall-send.ps1"

  ; 用户文本经临时文件传递（不进命令行，规避注入）；本版 NSIS 的 FileWrite 按本地
  ; 代码页（GBK）写出，PowerShell 侧按 BOM 自动判别编码读回（见发送脚本 ReadTextFile）
  ClearErrors
  FileOpen $6 "$3" w
  ${IfNot} ${Errors}
    FileWrite $6 "$0"
    FileClose $6
  ${EndIf}

  FileOpen $6 "$4" w
  ${IfNot} ${Errors}
    FileWrite $6 "$1"
    FileClose $6
  ${EndIf}

  ; 发送脚本：纯 ASCII、无 BOM（FileWrite 按本地代码页写，ASCII 在任何代码页下字节一致，
  ; PowerShell 无论按什么编码读都得到相同内容；PS 的 $ 一律写成 $$）
  FileOpen $6 "$5" w
  ${If} ${Errors}
    Goto un_feedback_fallback
  ${EndIf}
  !insertmacro MineradioUnFeedbackWriteLine $6 "param([string]$$FeedbackFile,[string]$$ContactFile,[string]$$Version,[string]$$Endpoint)"
  !insertmacro MineradioUnFeedbackWriteLine $6 "function ReadTextFile([string]$$p){"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$b=[IO.File]::ReadAllBytes($$p)"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  if($$b.Length -ge 2 -and $$b[0] -eq 255 -and $$b[1] -eq 254){ [Text.Encoding]::Unicode.GetString($$b) } else { [Text.Encoding]::Default.GetString($$b) }"
  !insertmacro MineradioUnFeedbackWriteLine $6 "}"
  !insertmacro MineradioUnFeedbackWriteLine $6 "try {"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$feedback = ReadTextFile $$FeedbackFile"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$contact = ReadTextFile $$ContactFile"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$payload = @{ feedback = $$feedback; contact = $$contact; version = $$Version; app = '${MINERADIO_MARKER_APP_ID}'; os = [Environment]::OSVersion.VersionString; time = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') } | ConvertTo-Json -Compress"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req = [Net.HttpWebRequest]::Create($$Endpoint)"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.Method = 'POST'"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.ContentType = 'application/json; charset=utf-8'"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.Accept = 'application/json'"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.Timeout = 15000"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.ReadWriteTimeout = 15000"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.Proxy = $$null"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.AllowAutoRedirect = $$false"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$data = [Text.Encoding]::UTF8.GetBytes($$payload)"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$req.ContentLength = $$data.Length"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$ws = $$req.GetRequestStream()"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$ws.Write($$data, 0, $$data.Length)"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$ws.Close()"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  $$code = 0"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  try { $$rr = $$req.GetResponse(); $$code = [int]$$rr.StatusCode; $$rr.Close() } catch [Net.WebException] { if ($$_.Exception.Response) { $$code = [int]$$_.Exception.Response.StatusCode } }"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  if ($$code -ge 200 -and $$code -lt 400) { exit 0 }"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  exit 1"
  !insertmacro MineradioUnFeedbackWriteLine $6 "} catch {"
  !insertmacro MineradioUnFeedbackWriteLine $6 "  exit 1"
  !insertmacro MineradioUnFeedbackWriteLine $6 "}"
  FileClose $6

  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$5" "$3" "$4" "$2" "${MINERADIO_FEEDBACK_ENDPOINT}"'
  Pop $7
  ${If} $7 == 0
    DetailPrint "Mineradio: uninstall feedback sent."
  ${Else}
    DetailPrint "Mineradio: uninstall feedback failed (exit $7)."
    Goto un_feedback_fallback
  ${EndIf}
  Goto un_feedback_done

  un_feedback_fallback:
    MessageBox MB_ICONINFORMATION|MB_YESNO "反馈没有发送成功（网络或服务不可用）。$\r$\n$\r$\n要打开网页反馈表单重新提交吗？选择「否」将直接继续卸载。" IDYES un_feedback_open_web
    Goto un_feedback_done

  un_feedback_open_web:
    ExecShell "open" "${MINERADIO_FEEDBACK_ENDPOINT}"

  un_feedback_done:
  Delete "$3"
  Delete "$4"
  Delete "$5"
FunctionEnd

!endif
!endif
