# UAT — User Acceptance Test corpus (gold set)

Real manuscript extracts used to measure whether the pipeline's output is *acceptable* (Phase-1
gate, AGENT-ARCHITECTURE §14). These are **paired**: an original manuscript and the same extract
after a human copy editor applied all changes. The human-edited version is the **gold standard** we
compare our suggestions against.

```
tests/uat/
  input/    original manuscripts (.docx)              — as submitted
  edited/   human-copyedited "gold" versions (.docx)   — all changes applied
```

Naming convention: `<name>.docx` in `input/` pairs with `<name>_Edited.docx` in `edited/`.

## ⚠️ Confidential — never committed

The contents of `input/` and `edited/` are **gitignored** (`tests/uat/*`). They are real, possibly
unpublished author manuscripts and must **not** be pushed to GitHub. Keep them local only. This
README is the only tracked file here.

## How they're used

- Convert an input `.docx` → run the pipeline: `pnpm ace edit tests/uat/input/<name>.docx`
- Diff our output against the `edited/` gold to see: (a) real edits we caught, (b) edits we missed,
  (c) false positives. Misses and false positives drive rule refinement; the human's edits are also
  flywheel training data.

Synthetic, hand-crafted fixtures live separately under `tests/fixtures/` (safe to commit).
