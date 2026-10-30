---
description: Close issues after a PR has merged to master
agent: orchestrator
---
Mark the issues in PR $1 as merged.

If `$1` is empty, ask for the PR number and stop.

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/agent/mark-merged.ps1 -Pr $1
```

GitHub auto-closes `Fixes #...` issues when the PR merges to `master`; this script still adds the `agent:merged` label and closes anything left open.

Report which issues were closed and their new labels.
