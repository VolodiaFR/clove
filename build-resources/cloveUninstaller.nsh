Function un.onInit
  SetOutPath "$TEMP"
  ${LogSet} on
  !insertmacro check64BitAndSetRegView
  !insertmacro initMultiUser
FunctionEnd

Section "Uninstall"
  SetDetailsPrint both
  DetailPrint "Removing Clove application files..."
  DetailPrint "The downloaded content library is retained for future installations."
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
