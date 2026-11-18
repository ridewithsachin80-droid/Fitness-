# Upgrade change list

All original source files are retained. Production output and preview screenshots are additional deliverables.

## Modified source and project files

- `client/index.html`
- `client/src/App.jsx`
- `client/src/components/AIChatLog.jsx`
- `client/src/components/AdminReminders.jsx`
- `client/src/components/ErrorBoundary.jsx`
- `client/src/components/StrengthProgress.jsx`
- `client/src/components/UI.jsx`
- `client/src/components/chat/ChatAtoms.jsx`
- `client/src/components/chat/ChatFoodMacros.jsx`
- `client/src/components/coach/MemberCharts.jsx`
- `client/src/components/sheets/PlatePhotoSheet.jsx`
- `client/src/components/today/Greeting.jsx`
- `client/src/index.css`
- `client/src/pages/DeviceConnect.jsx`
- `client/src/pages/Monitor.jsx`
- `client/src/pages/Profile.jsx`
- `client/src/pages/Progress.jsx`
- `client/src/pages/Settings.jsx`
- `client/src/pages/Today.jsx`
- `client/src/store/aiChatStore.js`
- `client/src/store/settingsStore.js`
- `client/tailwind.config.js`
- `server/package.json`
- `server/routes/aiChat.js`
- `server/scripts/test-layout-contracts.js`
- `server/scripts/ui-tests.mjs`

## Added source and project files

- `UPGRADE-README.md`
- `client/public/theme-init.js`
- `client/src/components/chat/AIFoodReview.jsx`
- `client/src/components/member/AILauncher.jsx`
- `client/src/components/member/DailyEssentials.jsx`
- `client/src/components/member/ThemeToggle.jsx`
- `client/src/components/member/member.css`
- `client/src/utils/aiFoodReview.js`
- `package-lock.json`
- `server/scripts/_debug-today.mjs`
- `server/scripts/test-premium-ui.mjs`

## Delivery additions

- `client/dist/`: production client build.
- `design-previews/`: rendered screens using sample data.
- `UPGRADE-TEST-REPORT.md`: validation and limits.
- `FILE-STRUCTURE.txt`: full archive contents.

No database schema or migration files were modified. Server routes and role permissions are retained; the AI parser adds a daily note field. Theme-related changes in existing pages/components replace fixed colours with shared tokens.
