---
description: Run checks, push a grouped branch, open one PR, and optionally post screenshots
agent: implementer
---
Ship the grouped worktree.

Read `.agent/ISSUES` for every issue number. Do not guess.

1. Run `npm run typecheck`.
2. Run `npm run test`; run `npm run build` when the client changed.
3. Commit any remaining changes on the current `wave/<slug>` branch.
4. Confirm the branch is not `master` or `main`.
5. For every issue with the `needs:screenshot` label, capture a screenshot and keep its URL.
6. Push the branch with `git push -u origin HEAD`.
7. Open one PR to `master` with `gh pr create --base master`.
   - Put one `Fixes #<number>` line per issue in the body.
   - Include each screenshot URL in the PR body.
8. Comment on every issue with the PR URL, the checks run, and its screenshot if one was captured.
9. Add the `agent:review` label to every issue.

Do not merge the PR, force-push, or push to `master` or `main`.
