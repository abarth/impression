---
name: fix-issues
description: Fetch all open GitHub issues and fix them one at a time, committing and pushing each fix.
allowed-tools: Bash(gh *), Bash(npm run *), Bash(git *)
---

Fix all open GitHub issues in the project, one at a time.

## Workflow

### 1. List open issues

Run `gh issue list --state open --label approved` to get all open, approved issues. If there are none, report that and stop.

Pick an issue to work on. Prefer issues that are not blocked by other open issues. If an issue has blocking issues that are still open, work on the blockers first.

### 2. For each issue

#### a. Read the issue

Run `gh issue view <number>` to get the full title and description.

#### b. Investigate the codebase

- Use the Explore agent or Grep/Glob/Read tools to understand the relevant code paths.
- Read all files involved before proposing changes.
- Understand the broader architecture around the issue, not just the immediate code.

#### c. Design the fix

Before writing code, evaluate whether the codebase is structured well enough to support a high-quality fix:

- If the fix would be a hack or workaround due to missing infrastructure, abstractions, or adjacent features, **file new blocking issues** using `gh issue create` for the prerequisite work. Reference the original issue in the body (e.g., "This blocks #N because..."). Then restart the workflow from step 1 — the new blocking issues will be picked up and resolved first.
- If the codebase is ready, proceed with the implementation.

The goal is to fix each issue in the *best* way, not the *fastest* way. Refactoring and prerequisite work are expected when they lead to a cleaner result.

#### d. Implement the fix

- Refactor as needed so the fix integrates cleanly into the codebase.
- Follow the project's existing patterns and conventions (see CLAUDE.md).

#### e. Write tests

- Every behavior change must include corresponding tests (Rust and/or TypeScript).
- Rust tests go in `#[cfg(test)] mod tests` blocks alongside the source.
- TypeScript tests go in `src/__tests__/`.
- Run `npm run test:all` (or `npm run test:rust` / `npm run test` individually) and fix any failures.

#### f. Commit and push

- Stage only the files you changed.
- Write a clear commit message summarizing the fix and referencing the issue (`Fixes #N`).
- Use the conventional commit format: `fix:`, `feat:`, etc.
- Push to origin: `git push`.

#### g. File follow-up issues

After fixing the issue, review the code you touched and the surrounding area. Look for:

- Technical debt or code smells exposed by the fix.
- Missing features or edge cases that would improve the user experience.
- Tests that should exist but don't.
- Documentation gaps.
- Performance improvements.
- Refactoring opportunities that would make future work easier.

For each item, file a new issue using `gh issue create`. Each issue should contain:

- A clear title describing the desired outcome.
- A description with enough context and detail (relevant file paths, current behavior, desired behavior, rationale) that a future coding agent can implement it without additional context.
- References to related issues or code if applicable.

### 3. Repeat

After committing and pushing, return to step 1 to check for remaining open issues. Continue until all issues are resolved.

## Important notes

- Do not close issues via the GitHub API; the `Fixes #N` in the commit message handles that on push.
- If an issue is ambiguous or requires clarification, ask the user before proceeding.
- Run the full test suite (`npm run test:all`) before each commit to ensure nothing is broken.
