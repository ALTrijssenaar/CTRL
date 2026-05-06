# CTRL Repository Hub

CTRL is an Electron desktop application that gives you one place to view all repositories you can access across GitHub and Azure DevOps, then clone any repository locally with one click.

## Features

- Unified repository overview across GitHub and Azure DevOps.
- Multiple GitHub enterprise connections and Azure DevOps organizations.
- One-click local cloning with deterministic folder structure.
- Insight labels for clone status, active local branch, open issues, and open pull requests.
- Secure Electron architecture:
  - renderer process for UI only,
  - main process for credentials, provider APIs, and filesystem operations.
- Architecture documentation and ADR history for maintainability.
- VS Code launch and task configuration for reliable debugging workflows.
- Copilot SKILLS for repo overview and repository sync flows.

## Project Structure

- `src/main/main.ts` Electron app lifecycle and IPC registration.
- `src/main/preload.ts` Typed secure bridge exposed to renderer.
- `src/main/providers` GitHub and Azure DevOps API adapters.
- `src/main/services` Settings and Git clone orchestration.
- `src/main/types/repository.ts` Shared domain models.
- `src/renderer` UI shell, logic, and styling.
- `docs/architecture.md` System architecture overview.
- `docs/adr` Architecture Decision Records.
- `.github/copilot/skills` Project SKILLS.
- `.vscode/launch.json` and `.vscode/tasks.json` Debug and task automation.

## Prerequisites

- Node.js 20+
- npm 10+
- Git installed and available in PATH

## Setup

```bash
npm install
```

## Run (Development)

```bash
npm run dev
```

This starts:

- TypeScript watch for Electron main process.
- Vite dev server for renderer (`http://localhost:5173`).
- Electron app loading the dev renderer URL.

## Run (Debug in VS Code)

Use launch configurations in `.vscode/launch.json`:

1. `Electron: Full Debug` (recommended)
2. `Electron: Main (Dist)` for production-style launch

## Build

```bash
npm run build
```

Build output:

- `dist/main`
- `dist/renderer`

## Type Check

```bash
npm run typecheck
```

## Configuration in App

Provide the following in the app UI:

- `GitHub Connections` JSON array
- `Azure Organizations` JSON array
- Local clone base path

Each connection can resolve credentials from either:

- inline `token` / `pat`
- environment variable name in `tokenEnvVar` / `patEnvVar`

Example `.env` support is provided in `.env.example`.
Runtime configuration is also loaded from `ctrl.config.json` next to `.env` (workspace root).
Use `ctrl.config.example.json` as a template.
When `ctrl.config.json` changes while the app is running, CTRL reloads configuration and repository insights automatically.

Settings are stored in a user-scoped JSON file under Electron user data directory.

### Example GitHub Connections JSON

```json
[
  {
    "id": "github-com",
    "name": "GitHub.com",
    "apiBaseUrl": "https://api.github.com",
    "token": "",
    "tokenEnvVar": "GITHUB_TOKEN"
  },
  {
    "id": "ghe-acme",
    "name": "Acme Enterprise",
    "apiBaseUrl": "https://ghe.acme.local/api/v3",
    "token": "",
    "tokenEnvVar": "GITHUB_ENTERPRISE_TOKEN"
  }
]
```

### Example Azure Organizations JSON

```json
[
  {
    "id": "azure-main",
    "name": "Main Org",
    "organizationUrl": "https://dev.azure.com/your-org",
    "pat": "",
    "patEnvVar": "AZURE_DEVOPS_PAT"
  },
  {
    "id": "azure-team2",
    "name": "Team 2 Org",
    "organizationUrl": "https://dev.azure.com/your-org-2",
    "pat": "",
    "patEnvVar": "AZURE_DEVOPS_PAT_TEAM2"
  }
]
```

## Documentation

- Architecture: `docs/architecture.md`
- Operating guide: `docs/operating-guide.md`
- ADRs:
  - `docs/adr/0001-electron-main-renderer-separation.md`
  - `docs/adr/0002-unified-repository-model.md`
  - `docs/adr/0003-credential-storage-and-clone-strategy.md`

## Security Notes

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- Clone credentials are applied only in main process.
- Token-bearing URLs are not displayed in renderer.

## Future Enhancements

- Add repository search and provider filters.
- Add branch checkout options after clone.
- Add background sync and cache timestamps.
- Introduce packaging workflow (`electron-builder`) for installers.
