FITLIFE — TEST GATE #55 REPAIR

Apply this smaller update ON TOP OF the P0 files already uploaded to test.
Base commit: 18ef815660225d5aaf67d5f0e679da70e696123b
Repair commit: fad08304a033b5fc78905dbddde54375fe6deaa6
Contains 16 changed files in repository folder structure.

1. Extract this archive. Merge client/, server/, qa/, .github/ and .gitignore
   into the repository root on branch test, replacing the matching files.
   Keep all other existing application files.
2. GitHub browser uploads have omitted hidden .github files twice. Check that
   .github/workflows/test-gate.yml matches this archive. If needed, use GitHub's
   Edit button on that file and paste the supplied complete replacement.
3. Commit to test and wait for the NEW Test gate run. Re-running #55 alone
   tests the old commit and will not pick up this repair.
4. Require the new complete gate to pass, then deploy that test revision and
   run the signed-in P0 cases in the updated Excel workbook.

The server package files now include browser test dependencies, so the missing
puppeteer-core failure is corrected even if an older workflow is still used.
The client build cleans generated dist before compiling; no frontend source
or visual design changed in this repair. The existing P0 UI is retained.
The updated workflow builds BEFORE testing and uploads regression evidence.

Other corrections: one-sided lab reference ranges and blank numeric bounds,
signed/expiring tracker callback state, and the journey assertion that must
retain an unfinished exercise while discarding its zero-rep sets.

Validation: clean build; fresh dependency install; 1,854 local assertions
passed across 21 suites. Local focused HTTP tests use synthetic SQL/provider
adapters. The 49 PostgreSQL suites still require a new CI run. This repair has
not been pushed or deployed by the assistant because repository writes were
denied. No production or real member data was changed.

Alternative in a clean checkout at the base commit:
  git apply --check /path/to/ci55-repair.patch
  git apply /path/to/ci55-repair.patch

CI55-README.txt and ci55-repair.patch are installation aids, not app files.
