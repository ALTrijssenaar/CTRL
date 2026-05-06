---
name: repo-sync
description: Implements and verifies one-click repository cloning workflows from CTRL into local workspace paths.
---

# Repo Sync Skill

## Purpose

Use this skill when implementing cloning behavior, path resolution, and clone result reporting.

## Inputs

- `CloneRequest` from renderer.
- Saved `AppSettings` with clone root and credentials.

## Outputs

- Deterministic local clone location.
- Clone result including `alreadyExists` status and local path.

## Guardrails

- Build authenticated clone URLs in main process only.
- Never return secret-bearing URLs to renderer.
- Preserve provider-agnostic clone orchestration.
