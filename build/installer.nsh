!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.activity_journal.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.activity_journal.host"
  RMDir /r "$LOCALAPPDATA\Activity Journal\NativeMessagingHost"
!macroend
