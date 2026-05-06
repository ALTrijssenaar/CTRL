# Architecture

## Goal

CTRL is a desktop repository cockpit that provides:

1. A single overview of all repositories accessible to the user across GitHub and Azure DevOps.
2. One-click local cloning of any listed repository.
3. A maintainable structure with explicit architecture decisions.

## System Context

- User interacts with Electron desktop UI.
- Main process acts as secure boundary for credentials and filesystem operations.
- Provider adapters call GitHub and Azure DevOps REST APIs.
- Git service clones repositories locally through the system Git CLI.

## High-Level Design

### Renderer Process

- Location: `src/renderer`
- Responsibilities:
  - Render settings and repository overview.
  - Trigger repository refresh and clone actions.
  - Never directly access Node APIs.

### Preload Bridge

- Location: `src/main/preload.ts`
- Responsibilities:
  - Expose a narrow, typed API (`window.ctrlApi`) to renderer.
  - Keep IPC channel names centralized and predictable.

### Main Process

- Location: `src/main/main.ts`
- Responsibilities:
  - Register IPC handlers.
  - Read and persist settings.
  - Aggregate repositories from providers.
  - Execute clone actions through `simple-git`.

### Provider Adapters

- Locations:
  - `src/main/providers/github-provider.ts`
  - `src/main/providers/azure-provider.ts`
- Responsibilities:
  - Translate provider-specific API payloads to a unified `RepositorySummary` model.

### Services

- Locations:
  - `src/main/services/settings-store.ts`
  - `src/main/services/git-service.ts`
- Responsibilities:
  - Persist credentials and defaults in a local user-scoped JSON settings file.
  - Handle deterministic clone path generation and authenticated clone URLs.

## Data Flow

1. Renderer loads settings via `settings:get`.
2. User clicks refresh.
3. Renderer calls `repos:list`.
4. Main process fetches repositories from all providers in parallel.
5. Unified list returns to renderer and is displayed.
6. User clicks clone.
7. Renderer calls `repo:clone` with selected repository.
8. Main resolves target path and performs clone.
9. Clone result returns with local path.

## Security Model

- Credentials are handled in main process only.
- Renderer gets only operational outcomes and repository metadata.
- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- Token-bearing clone URLs are never rendered in UI.

## Extensibility

To add a new provider:

1. Add adapter in `src/main/providers` that returns `RepositorySummary[]`.
2. Update aggregator in `src/main/main.ts`.
3. Add provider-specific settings fields in shared `AppSettings` model and UI.
4. Extend clone auth URL strategy in `git-service.ts`.

## Operational Notes

- Main process code is TypeScript-compiled to `dist/main`.
- Renderer is served by Vite in dev and built to `dist/renderer` in production mode.
- VS Code debug profile supports full-stack launch and attach for Electron main process.
