---
name: repo-overview
description: Generates and validates a repository health overview from GitHub and Azure DevOps data exposed by CTRL.
---

# Repo Overview Skill

## Purpose

Use this skill when working on features related to repository discovery, list rendering, and cross-provider consistency.

## Inputs

- Repository lists from `repos:list` IPC handler.
- Unified `RepositorySummary` entries.

## Outputs

- Stable, provider-agnostic repository list views.
- Validation checks for repository metadata completeness.

## Guardrails

- Do not expose credentials in renderer output.
- Keep provider-specific transformations in adapter files only.
