# ADR-0007: Trunk-based development with short-lived branches

**Status:** Accepted · **Date:** 2026-10-15

## Context

Four developers must integrate daily without long-lived divergence.

## Decision

Branch from `main` as `type/ISSUE-short-name`, open a PR early, merge when CI is green and a reviewer approves (CODEOWNERS). Migrations are never edited after they are pushed; fixes are new migrations.

## Consequences

- Small PRs; the migration log in `docs/08-data-model.md` stays linear.
