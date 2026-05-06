# Operating Guide

## Required Access

- GitHub Personal Access Token with `repo` scope for private repositories.
- Azure DevOps Personal Access Token with:
  - Code: Read
  - Project and Team: Read (if required by org policy)

## Secrets via .env

1. Copy `.env.example` to `.env`.
2. Add your tokens and PATs to `.env` values.
3. In app settings JSON, refer to env vars through `tokenEnvVar` / `patEnvVar`.

`.env` is ignored from git by default.

## Multiple Source Configuration

- `GitHub Connections` supports multiple entries, including GitHub Enterprise instances.
- `Azure Organizations` supports multiple Azure DevOps organization URLs.
- Each connection is uniquely identified by `id` and shown in repository cards as source label.

## First Run

1. Start app with `npm run dev`.
2. Open **Connections** panel.
3. Enter credentials and local clone root.
4. Save settings.
5. Click **Refresh Repositories**.
6. Click **Clone** on any repository card.

## Clone Path Convention

Repositories are cloned under:

- GitHub: `<cloneBasePath>/github/<owner>/<repo>`
- Azure DevOps: `<cloneBasePath>/azure-devops/<project>/<repo>`

## Troubleshooting

- Empty list:
  - Verify PAT scopes and env var names.
  - Confirm Azure organization URL format: `https://dev.azure.com/<org>`.
- Clone fails with authentication:
  - Regenerate PAT and update settings.
  - Ensure local Git is installed and available in PATH.
- Existing repository reported:
  - App detects existing directory and skips reclone by design.

## Maintenance Checklist

- Update dependencies monthly.
- Revalidate provider API versions quarterly.
- Add or update ADRs for architecture-impacting changes.
