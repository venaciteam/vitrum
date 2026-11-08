; Crochets de l'installateur Windows (NSIS) de Vitrum.
;
; Tauri associe déjà les extensions au type « Vitrum.Markdown ». On ajoute :
;  - Vitrum dans « Ouvrir avec » (OpenWithProgids, Applications\vitrum.exe) ;
;  - la déclaration auprès des « Applications par défaut » de Windows ;
;  - la proposition, en fin d'installation, d'en faire l'appli par défaut des .md.
; Windows interdit de se déclarer par défaut sans l'accord de la personne :
; on ouvre donc la page des Paramètres consacrée à Vitrum.

!define VITRUM_PROGID "Vitrum.Markdown"
!define VITRUM_CAPS "Software\Vitrum\Capabilities"

!macro VITRUM_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${VITRUM_PROGID}" ""
  WriteRegStr SHCTX "${VITRUM_CAPS}\FileAssociations" ".${EXT}" "${VITRUM_PROGID}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro VITRUM_FORGET EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${VITRUM_PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro VITRUM_OPEN_WITH "md"
  !insertmacro VITRUM_OPEN_WITH "markdown"
  !insertmacro VITRUM_OPEN_WITH "mdown"
  !insertmacro VITRUM_OPEN_WITH "mkd"
  !insertmacro VITRUM_OPEN_WITH "mkdn"

  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\${VITRUM_PROGID}" "FriendlyTypeName" "Document Markdown"
  WriteRegStr SHCTX "Software\Classes\${VITRUM_PROGID}\shell\open" "" "Ouvrir avec Vitrum"

  WriteRegStr SHCTX "${VITRUM_CAPS}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${VITRUM_CAPS}" "ApplicationDescription" "Lecteur et éditeur Markdown"
  WriteRegStr SHCTX "${VITRUM_CAPS}" "ApplicationIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Vitrum" "${VITRUM_CAPS}"

  ; Prévient l'Explorateur que les associations ont changé (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice" "ProgId"
    ${If} $0 != "${VITRUM_PROGID}"
      MessageBox MB_YESNO|MB_ICONQUESTION "Ouvrir les fichiers Markdown (.md) avec Vitrum par défaut ?$\n$\nWindows va afficher la page « Applications par défaut » de Vitrum : cliquez sur .md, choisissez Vitrum, puis « Définir par défaut »." IDNO vitrum_skip_default
        ExecShell "open" "ms-settings:defaultapps?registeredAppUser=Vitrum"
      vitrum_skip_default:
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro VITRUM_FORGET "md"
  !insertmacro VITRUM_FORGET "markdown"
  !insertmacro VITRUM_FORGET "mdown"
  !insertmacro VITRUM_FORGET "mkd"
  !insertmacro VITRUM_FORGET "mkdn"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Vitrum"
  DeleteRegKey SHCTX "Software\Vitrum"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
