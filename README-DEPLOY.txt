FitLife — reference ranges on lab values
========================================

1 FILE. Extract, drag the "client" FOLDER onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change. Server untouched —
the API already returned ref_min and ref_max, they were simply not displayed.

WHAT CHANGED
Each lab value now shows its reference range beneath the result:

    HbA1C - Glycated Haemoglobin        5.90 %   high
    Wed, 12 Aug                         ref 4.0-5.6 %

Ranges written as an upper or lower bound only are rendered as "< 200" or
"> 40" rather than a half-empty range.

A POSITION BAR, WHICH IS THE MORE USEFUL PART
When both bounds are known, a thin bar shows where the result actually sits
inside the range, with the normal band shaded green and a dot for the value.

Two results can both read "normal" while one sits at the very edge of the
range and the other in the middle. From Harsha's own panel:

    PCV 40.3, range 40-50   -> normal, but sitting right on the lower bound
    MCV 86.2, range 83-101  -> normal, comfortably mid-range

The status badge calls both "normal". The bar shows they are not the same
situation, and that difference is what a coach acts on.

Out-of-range values stay visible rather than clamping invisibly to the edge:
the bar is drawn with a 35% margin either side, so the normal band occupies
the middle and a high or low result sits clearly outside it. Verified across
seven positions including far-out values.

THE PRINTED REPORT NOW CARRIES RANGES TOO
Print Report gained a Reference column. A clinical PDF listing values without
their ranges is not much use to whoever reads it next.

TESTS
Regression: 107 assertions across the two affected suites, all passing.
