# University configuration / approval inputs

The application can be built and tested with synthetic data without these values. Real student data should wait for the university's normal review/approval process.

1. Whether current-user Windows DPAPI is accepted for local-at-rest protection or another approved mechanism is required.
2. Staff/faculty-only synchronization share/service path.
3. Machine/device/service identity allowed to transport encrypted packets while student user accounts remain unable to browse the share.
4. Geolocation/VPN/network rules and expected offline behavior.
5. Whether the chosen transport is on-premises or Microsoft cloud-backed storage.
6. Approved Microsoft Copilot URL/experience and whether Torgy's local WebView DOM bridge is permitted.
7. Outlook Entra public-client registration, tenant ID, delegated `Calendars.ReadWrite` permission, redirect configuration, and Conditional Access requirements.
8. Approved academic-data import path: local Google Docs/Sheets export, direct Canvas, or another mechanism.
9. Retention requirements for local backups and logs. Torgy avoids sensitive application logging by default.
10. Installer signing and managed-software deployment method.
11. Whether the included SYSTEM scheduled-worker model is approved or should be replaced by an IT-standard service/package.
12. Which task/notes fields may synchronize to student devices and which coordinator-only fields must remain local.

These values affect deployment configuration and institutional approval. They are not hard-coded credentials and should not be committed to GitHub.
