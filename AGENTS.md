# AGENTS.md

## Repository Rules

1. Always update this file when you learn something new, durable, and repository-specific that will help future work.
2. Keep entries concise and factual.
3. Prefer recording verified build commands, runtime behavior, config locations, cache behavior, and integration constraints.
4. Do not record secrets, tokens, PATs, or environment variable values.

## Known Repo Facts

- Project type: Electron desktop app with TypeScript main process and Vite renderer.
- Development commands:
  - `npm run dev`
  - `npm run dev:debug`
  - `npm run typecheck`
  - `npm run build`
- Dev Electron process auto-restarts on `dist/main` changes through `nodemon` in `dev:electron` scripts.
- Window bounds and maximize state are persisted in Electron user data to preserve snapped/sized layouts (for example with FancyZones) across restarts.
- Runtime configuration is loaded from `ctrl.config.json` in the repository root, next to `.env`.
- Environment variables are loaded from `.env` via `dotenv` in the Electron main process.
- Supported sources:
  - GitHub.com and GitHub Enterprise through `githubConnections`
  - Azure DevOps organizations through `azureOrganizations`
- GitHub repository listing paginate through all available repos (100 per page, no hard limit) to support users with >1000 accessible repositories.
- Repository cards are intended to show clone status, local branch, open issues, and open pull request counts.
- Repository cards also surface cache freshness metadata (`dataSource`, cache age).
- Live reload exists for `ctrl.config.json` changes while the app is running.
- Repository lists are cached persistently in Electron user data and reused across app restarts before background refresh.
- Persistent repository cache file path on Linux: `~/.config/ctrl-repo-hub/repository-cache.json`.
- Cache-first startup renders repository lists without waiting on remote issue/PR metrics; background refresh later enriches live data.
- GitHub activity enrichment is GraphQL-first with REST search fallback, and unread notification counts are fetched from the GitHub notifications endpoint per connection when available.
- The renderer exposes fetch diagnostics in a collapsible "Debug Console" frame.
- Repository source groups in the renderer are collapsible and retain expanded/collapsed state across refresh rerenders.
- Repository groups now display aggregate metrics: total issues and PRs count from all repos in each group, shown as stat badges in the group header.
- Repository names show provider description text on hover when available.
- Repository list is presented as a folder-tree hierarchy: connection-level source groups contain organization folders for GitHub and project folders for Azure DevOps; Azure repository leaves also show project metadata.
- Repository tree supports header-level Expand All and Collapse All controls for source and namespace nodes.
- Connection settings are exposed through a collapsible drawer in the renderer instead of an always-open panel.
- Repository group titles simplified to show only connection name (e.g., "azure-trijssenaar"); provider type appears in group subtitle instead to reduce visual clutter.
- Repository group titles and source labels should use connection `id` values (not display names).
- Repository list header includes separate "Issues/PRs Only" and "Unread Only" filter buttons; filters are strict and only show repositories with matching activity.
- Repository list header includes a top-level "Refresh" button next to expand/collapse/filter controls for quick live refresh access.
- Renderer layout uses a wide primary repository pane with a right-side rail for connection settings and debug drawers; repository summary cards sit above the tree to use desktop width more effectively.
- Linux runtime may require Electron system libraries and hardware acceleration is disabled in the main process for stability.
- Repository loading should degrade gracefully per source so one failing provider does not block all others.
- Main-process repository fetch logs include source-level status and total list request duration for terminal diagnostics.
- Remote metrics calls (issues/PR counts) use short timeouts to avoid long UI stalls when providers are slow.
- **Metrics caching**: Issue/PR counts and unread notification counts are cached alongside repositories in `repository-cache.json`. After enriching repos with metrics during background refresh, enriched repos are saved back to cache. This enables instant filtering on startup without waiting for remote metrics—cached metrics are available immediately, then updated in background.
- Connection objects support namespace exclusions: `excludeOrganizationsFromLoading` (GitHub) and `excludeProjectsFromLoading` (Azure DevOps); excluded namespaces are omitted from cache and live loading.
- Renderer settings drawer includes namespace-level loading toggles (GitHub organizations and Azure projects) that persist directly to `ctrl.config.json`.
- Provider adapters also enforce namespace exclusions during source fetch so excluded repos never enter metrics enrichment.
- GitHub metrics enrichment uses a timeout-based GraphQL cooldown (5 minutes) to avoid per-repo timeout log floods, then falls back to REST search.
- GitHub metrics enrichment is concurrency-limited (8 repos at a time) and keeps cached metrics when live GraphQL/REST calls fail, reducing timeout frequency and UI metric flapping.
- GitHub REST search fallback now classifies HTTP 403 failures (rate-limit vs forbidden), logs one source-level warning, and temporarily suppresses repeated REST fallback attempts for 5 minutes while cached metrics are reused.
- Repository cards now include an Analyze action that inspects default-branch content (local clone or temporary shallow clone) and stores a concise local description override in Electron user data, which is applied across cache/live repository lists.
- Analyze also attempts provider write-back: GitHub via repository PATCH and Azure DevOps via repositories update PATCH; local description overrides are still applied even when remote write-back fails.
- Analyze README extraction now filters image refs, badges, URLs, and file/path-like lines so generated descriptions remain plain explanatory text.
- Analyze now produces a multi-sentence README summary (scored from multiple candidate lines) instead of a single first sentence; when README is missing, it summarizes the whole repository from scanned structure and dominant file types.
- Analyze descriptions prioritize reader usefulness by combining purpose sentences with concrete key capabilities, major README areas, and notable repository contents (top directories/root files) where available.
- `excludeFromLiveRefresh` now behaves as full source exclusion: excluded sources are omitted from startup cache results and live refreshes (not loaded at all).

## Maintenance Expectation

When a future change reveals a new stable fact about this repo, append or revise the relevant section in this file as part of the same task.
