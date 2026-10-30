---
description: Capture a screenshot on demand and post it to the issue
agent: implementer
---
Capture a screenshot for issue $1 on demand, then post it to the issue.

If `$1` is empty, read `.agent/ISSUES` for the current worktree and ask which issue to use.

1. Read the issue and its triage comment for the screenshot plan: role, hash path, viewport, and what should be visible.
2. Run this from the current worktree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/agent/capture-screenshot.ps1 `
  -Issue $1 -Path "/#/dashboard" -Role app -Mobile `
  -StartServer -Worktree (Get-Location).Path -PostComment
```

Use the real values from the screenshot plan:

- `-Role public` for the login screen; `-Role app` for a signed-in page.
- `-Path "/#/review"` for a specific hash route.
- `-Mobile` for iPhone width (`390x844`), omit for desktop.
- `-Click "button:has-text('Take photo')"` if the screenshot needs a modal open.
- `-WaitFor "text=..."` if the page needs a selector before capture.

For `-Role app`, set `AGENT_SCREENSHOT_PIN` in `.env` or pass `-Pin`.

Report the screenshot URL and the issue comment URL. Do not change code.
