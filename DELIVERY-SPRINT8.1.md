# Sprint 8.1 — Needs-attention rows at 360 px

Seen while producing the visuals: at 360 px the counts line wrapped under the heading and long
names truncated ("Sharada R…") because the week dots shared the line with the name and the action.

- Rows are now two lines: **name + action**, then **week dots + reason**. Names show in full.
- The counts ("9 members · 5 on track · 3 need attention · 1 high") are their own line under
  the heading.

Behaviour, data and actions are unchanged. Gate green (UI suite and contracts re-run).

## This zip is a DELTA
```
Fitness--main/
├── DELIVERY-SPRINT8.1.md                          (new)
└── client/src/components/coach/TriageFeed.jsx     (changed)
```
Apply after the combined 7b + 8 + 9a zip.
