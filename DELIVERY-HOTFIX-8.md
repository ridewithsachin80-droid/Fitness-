# Hotfix — Sprint 8 zip was missing `client/src/components/coach/`

Railway build failed after the Sprint 8 upload:
`Could not resolve "../components/coach/TriageFeed" from "src/pages/PatientList.jsx"`.

Cause: the Sprint 8 delta zip was created without recursing into the NEW folder, so
`components/coach/` went in as an empty directory and `TriageFeed.jsx` never reached GitHub.
The code was right; the package was not. Packaging now always recurses, and every delta is
checked for empty directory entries before it ships.

## Upload — drag `Fitness--main` onto GitHub
```
Fitness--main/
├── DELIVERY-HOTFIX-8.md                           (new)
└── client/src/components/coach/
    ├── TriageFeed.jsx                             (NEW — the missing file; Sprint 8)
    └── MemberBrief.jsx                            (NEW — Sprint 9a; included so 9a is complete too)
```
After this upload the Sprint 9a delta can be applied (or has already been) — it contains
everything else from 9a.
