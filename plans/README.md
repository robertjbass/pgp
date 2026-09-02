# Plans

Work is tracked as one markdown file per plan.

- `pending/` - plans not yet finished. A plan may be partially done; its checklist shows progress.
- `complete/` - plans where every item is done and verified. Move the file here when finished.
- `TRACKER.md` - master index. Update it whenever a plan changes status.

## Plan file format

```
# NN - Title

**Status:** pending | in progress | complete
**Priority:** 1 (highest) .. 5
**Source:** where the work came from (audit, bug report, idea)

## Why
## Scope (checklist)
## Out of scope
## Verification
## Notes
```

Number plans in the order they should be done. Numbers are never reused.
