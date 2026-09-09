# Sprint 9b delivery — member page: timeline, Full log, one action sheet; Admin shortcuts

Gate: **2,169 assertions green** (9a: 2,149). `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 9a (+8.1)
```
Fitness--main/
├── DELIVERY-SPRINT9b.md                           (new)
├── client/src/
│   ├── pages/Monitor.jsx                          (changed)
│   ├── pages/AdminDashboard.jsx                   (changed: Coach view ›)
│   ├── components/coach/MemberActionSheet.jsx     (NEW)
│   ├── components/MessageMember.jsx               (changed: `embedded` mode)
│   ├── components/TodaysGaps.jsx                  (changed: names open the member page)
│   ├── components/AdminReminders.jsx              (changed: tokened buttons)
│   ├── components/today/Timeline.jsx              (changed: readOnly + member slots)
│   └── lib/day/
│       ├── fromServerLog.js                       (NEW — server row → timeline model)
│       └── index.js                               (changed)
└── server/scripts/
    ├── test-layout-contracts.js                   (changed)
    └── ui-tests.mjs                               (changed)
```
No schema, route or server-runtime change.

## What you see

**Member page (`/coach/<id>`), Today tab.** Under the date chips, the member's own
timeline — the same component they see on Today, read-only, grouped by *their* meal slots:
weight with the change vs the previous log, each meal with its kcal, water, sleep. Below it,
**Full log** — every tick, macro and note for that day — collapsed with its compliance number
as the summary; tap to open.

**One action sheet.** *Add Note* and *Message* in the header now open the same bottom sheet
with tabs:
- **Note** — date, text, "Action needed". Saved on the member's record; appears on the page
  immediately.
- **Message** — WhatsApp / SMS from your own phone, with a copy kept as a note (as before).
- **Push** — admin only (the server allows only admins): title + message → a phone
  notification for that member.

**Admin.** A gold **Coach view ›** button next to *Sign out* takes you to the Needs-attention
list. In *Today's gaps*, tapping a **name** opens that member's page (the Message button still
does what it did). The Reminders tab's blue/green **Test** and red **Del** fills are now the
app's button language — gold primary, quiet secondary, red text for delete.

## Verified
- jsdom (+15): timeline rows on the coach page with no buttons/chevrons; member's slot order
  and ↓ 0.4 vs the previous log; Full log collapsed with "40%", opens to show the note; Add
  Note → sheet on Note tab with Note · Message · Push for an admin; Save disabled until text;
  saving POSTs with the flag, closes the sheet, note appears; Message tab shows WhatsApp/SMS;
  Push POSTs `/admin/push` with `patient_id`; Escape closes; a coach (non-admin) sees
  Note · Message only.
- Contracts: both header buttons route to the one sheet, old modal/overlay no longer rendered;
  Timeline read-only with member slots above a Full log Collapsible; push admin-only;
  Coach view shortcut; gap names navigate; reminders buttons tokened; Sign out still
  unsqueezable.
- Real Chrome at 360 px: the member page renders the timeline and Full log; screenshot
  checked by eye.
