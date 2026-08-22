FitLife — lab values grouped by report date
===========================================

1 FILE. Extract, drag the "client" FOLDER onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change. Server untouched.

WHAT CHANGED
Lab values are now one collapsible panel per report date instead of a single
long list. Each header shows the date, how many results it contains, how many
sit outside range, and the lab name:

    Wed, 12 Aug        24 results · 6 outside range · Metropolis   ▲
    Mon, 4 May          8 results · 2 outside range                ▼
    Sat, 20 Dec         6 results · 1 outside range                ▼

The newest report is expanded by default and older ones stay collapsed, so a
member with a year of panels sees a short list of dates rather than two
hundred rows. When they upload another report, a new panel appears
automatically at the top and becomes the expanded one — no configuration.

Once there are two or more reports, an "Expand all / Collapse all" control
appears next to + Add.

Results within a panel are now sorted alphabetically rather than appearing in
whatever order the PDF extractor happened to emit them, so the same test sits
in the same place across reports and can be compared by eye.

The reference ranges and position bars are unchanged — they now live inside
the panels.

A BUG CAUGHT BY LINTING, NOT BY THE BUILD
My first attempt anchored the new state on a variable named showLab. The
actual variable is showLabForm, so the edit silently did nothing and the
component referenced openPanels without ever declaring it. The production
build compiled it happily; it would have crashed the moment a coach opened a
member. The linter caught it, which is why I now run it on every file I touch
rather than trusting a green build.

TESTS
Grouping, sorting and default-open state verified against a three-report
history. Regression: 107 assertions across the two affected suites, passing.
