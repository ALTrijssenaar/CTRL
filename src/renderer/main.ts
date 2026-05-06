type Provider = "github" | "azure-devops";

interface GitHubConnection {
  id: string;
  apiBaseUrl: string;
  token: string;
  tokenEnvVar: string;
  excludeFromLiveRefresh?: boolean;
  excludeOrganizationsFromLoading?: string[];
}

interface AzureOrganizationConnection {
  id: string;
  organizationUrl: string;
  pat: string;
  patEnvVar: string;
  excludeFromLiveRefresh?: boolean;
  excludeProjectsFromLoading?: string[];
}

interface RepositorySummary {
  id: string;
  provider: Provider;
  name: string;
  fullName: string;
  description?: string | null;
  cloneUrl: string;
  webUrl: string;
  defaultBranch: string;
  visibility: string;
  project?: string;
  sourceId: string;
  sourceLabel: string;
  githubApiBaseUrl?: string;
  githubOwnerLogin?: string;
  githubOwnerType?: string;
  azureOrganizationUrl?: string;
  localPath?: string;
  isCloned?: boolean;
  localBranch?: string | null;
  openIssues?: number | null;
  openPullRequests?: number | null;
  unreadNotifications?: number | null;
  cacheUpdatedAt?: number | null;
  cacheAgeSeconds?: number | null;
  dataSource?: "cache" | "live";
}

type RepositoryFilterMode = "all" | "issues" | "prs" | "notifications";

interface RepositorySourceDebugState {
  provider: Provider;
  sourceId: string;
  sourceLabel: string;
  repositoryCount: number;
  cacheUpdatedAt: number | null;
  cacheAgeSeconds: number | null;
  lastFetchStatus:
    | "idle"
    | "cache-hit"
    | "cache-miss"
    | "refreshing"
    | "success"
    | "fallback"
    | "error"
    | "skipped";
  lastFetchAt: number | null;
  lastError: string | null;
}

interface RepositoryDebugState {
  cacheFilePath: string;
  lastLiveRefreshAt: number | null;
  sources: RepositorySourceDebugState[];
}

interface AppSettings {
  githubConnections: GitHubConnection[];
  azureOrganizations: AzureOrganizationConnection[];
  cloneBasePath: string;
}

interface CloneResult {
  localPath: string;
  alreadyExists: boolean;
}

interface AnalyzeRepositoryDescriptionResult {
  description: string;
  remoteUpdated: boolean;
  remoteError?: string;
}

const form = document.querySelector<HTMLFormElement>("#settings-form");
const settingsStatus =
  document.querySelector<HTMLParagraphElement>("#settings-status");
const repoList = document.querySelector<HTMLDivElement>("#repo-list");
const repoSummary = document.querySelector<HTMLDivElement>("#repo-summary");
const repoCount = document.querySelector<HTMLSpanElement>("#repo-count");
const expandAllButton =
  document.querySelector<HTMLButtonElement>("#expand-all");
const collapseAllButton =
  document.querySelector<HTMLButtonElement>("#collapse-all");
const filterNotificationsButton = document.querySelector<HTMLButtonElement>(
  "#filter-notifications",
);
const filterIssuesButton =
  document.querySelector<HTMLButtonElement>("#filter-issues");
const filterPrsButton =
  document.querySelector<HTMLButtonElement>("#filter-prs");
const debugRefresh = document.querySelector<HTMLSpanElement>("#debug-refresh");
const debugCachePath =
  document.querySelector<HTMLParagraphElement>("#debug-cache-path");
const debugList = document.querySelector<HTMLDivElement>("#debug-list");

const fieldRefs = {
  githubConnections:
    document.querySelector<HTMLTextAreaElement>("#githubConnections"),
  azureOrganizations: document.querySelector<HTMLTextAreaElement>(
    "#azureOrganizations",
  ),
  cloneBasePath: document.querySelector<HTMLInputElement>("#cloneBasePath"),
};

function requireElement<T>(value: T | null, selector: string): T {
  if (!value) {
    throw new Error(`Missing element: ${selector}`);
  }

  return value;
}

const requiredForm = requireElement(form, "#settings-form");
const requiredSettingsStatus = requireElement(
  settingsStatus,
  "#settings-status",
);
const requiredRepoList = requireElement(repoList, "#repo-list");
const requiredRepoSummary = requireElement(repoSummary, "#repo-summary");
const requiredRepoCount = requireElement(repoCount, "#repo-count");
const requiredExpandAllButton = requireElement(expandAllButton, "#expand-all");
const requiredCollapseAllButton = requireElement(
  collapseAllButton,
  "#collapse-all",
);
const requiredFilterIssuesButton = requireElement(
  filterIssuesButton,
  "#filter-issues",
);
const requiredFilterPrsButton = requireElement(filterPrsButton, "#filter-prs");
const requiredFilterNotificationsButton = requireElement(
  filterNotificationsButton,
  "#filter-notifications",
);
const requiredDebugRefresh = requireElement(debugRefresh, "#debug-refresh");
const requiredDebugCachePath = requireElement(
  debugCachePath,
  "#debug-cache-path",
);
const requiredDebugList = requireElement(debugList, "#debug-list");
const collapsedGroupKeys = new Set<string>();
const collapsedNamespaceKeys = new Set<string>();
let filterMode: RepositoryFilterMode = "all";

function parseJsonArray<T>(input: string, label: string): T[] {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`);
    }

    return parsed as T[];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Invalid ${label} JSON.`;
    throw new Error(`Invalid ${label} JSON: ${message}`);
  }
}

function settingsFromForm(): AppSettings {
  const githubConnectionsJson = requireElement(
    fieldRefs.githubConnections,
    "#githubConnections",
  ).value;
  const azureOrganizationsJson = requireElement(
    fieldRefs.azureOrganizations,
    "#azureOrganizations",
  ).value;

  return {
    githubConnections: parseJsonArray<GitHubConnection>(
      githubConnectionsJson,
      "GitHub Connections",
    ),
    azureOrganizations: parseJsonArray<AzureOrganizationConnection>(
      azureOrganizationsJson,
      "Azure Organizations",
    ),
    cloneBasePath: requireElement(fieldRefs.cloneBasePath, "#cloneBasePath")
      .value,
  };
}

function assignSettings(settings: AppSettings): void {
  requireElement(fieldRefs.githubConnections, "#githubConnections").value =
    JSON.stringify(settings.githubConnections, null, 2);
  requireElement(fieldRefs.azureOrganizations, "#azureOrganizations").value =
    JSON.stringify(settings.azureOrganizations, null, 2);
  requireElement(fieldRefs.cloneBasePath, "#cloneBasePath").value =
    settings.cloneBasePath;
  currentSettings = settings;
  renderNamespaceToggles(settings, currentRepositories);
}

let currentSettings: AppSettings | null = null;
let currentRepositories: RepositorySummary[] = [];

function normalizeNamespace(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueNamespaces(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeNamespace(trimmed);
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

function renderNamespaceToggles(
  settings: AppSettings,
  repositories: RepositorySummary[],
): void {
  const container = document.querySelector<HTMLDivElement>(
    "#connection-toggles",
  );
  if (!container) {
    return;
  }

  const githubSections = settings.githubConnections.map((connection) => {
    const fromRepos = repositories
      .filter(
        (repo) => repo.provider === "github" && repo.sourceId === connection.id,
      )
      .map((repo) => repo.fullName.split("/")[0] ?? "")
      .filter(Boolean);
    const namespaces = uniqueNamespaces([
      ...fromRepos,
      ...(connection.excludeOrganizationsFromLoading ?? []),
    ]);
    return {
      provider: "github" as const,
      id: connection.id,
      name: connection.id,
      namespaceLabel: "Organizations",
      namespaces,
      excludedNamespaces: connection.excludeOrganizationsFromLoading ?? [],
    };
  });

  const azureSections = settings.azureOrganizations.map((connection) => {
    const fromRepos = repositories
      .filter(
        (repo) =>
          repo.provider === "azure-devops" && repo.sourceId === connection.id,
      )
      .map((repo) => repo.project || repo.fullName.split("/")[0] || "")
      .filter(Boolean);
    const namespaces = uniqueNamespaces([
      ...fromRepos,
      ...(connection.excludeProjectsFromLoading ?? []),
    ]);
    return {
      provider: "azure-devops" as const,
      id: connection.id,
      name: connection.id,
      namespaceLabel: "Projects",
      namespaces,
      excludedNamespaces: connection.excludeProjectsFromLoading ?? [],
    };
  });

  const allSections = [...githubSections, ...azureSections];

  container.innerHTML = allSections
    .map((section) => {
      const namespaceHtml =
        section.namespaces.length > 0
          ? section.namespaces
              .map((namespace) => {
                const excluded = section.excludedNamespaces.some(
                  (entry) =>
                    normalizeNamespace(entry) === normalizeNamespace(namespace),
                );
                return `
                  <div class="toggle-row" title="${excluded ? "Excluded" : "Included"}">
                    <span class="connection-toggle-name">${escapedHtml(namespace)}</span>
                    <label class="toggle-switch" title="${excluded ? "Excluded" : "Included"}">
                      <input
                        type="checkbox"
                        class="toggle-input"
                        data-provider="${escapedHtml(section.provider)}"
                        data-connection-id="${escapedHtml(section.id)}"
                        data-namespace="${escapedHtml(namespace)}"
                        ${excluded ? "checked" : ""}
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>`;
              })
              .join("")
          : '<p class="hint">No namespaces discovered yet. Refresh repositories first.</p>';

      return `
      <div class="connection-toggle-card">
        <div class="connection-toggle-info">
          <span class="connection-toggle-name">${escapedHtml(section.name)}</span>
          <span class="tag">${escapedHtml(providerLabel(section.provider))}</span>
          <span class="tag">${escapedHtml(section.namespaceLabel)}</span>
        </div>
        <div class="toggle-list">${namespaceHtml}</div>
      </div>`;
    })
    .join("");

  container
    .querySelectorAll<HTMLInputElement>(".toggle-input")
    .forEach((input) => {
      input.addEventListener("change", () => {
        if (!currentSettings) {
          return;
        }

        const provider = input.dataset.provider as Provider;
        const connectionId = input.dataset.connectionId;
        const namespace = input.dataset.namespace ?? "";
        const excluded = input.checked;

        const updatedGithub = currentSettings.githubConnections.map((c) =>
          c.id === connectionId && provider === "github"
            ? {
                ...c,
                excludeOrganizationsFromLoading: uniqueNamespaces(
                  excluded
                    ? [...(c.excludeOrganizationsFromLoading ?? []), namespace]
                    : (c.excludeOrganizationsFromLoading ?? []).filter(
                        (entry) =>
                          normalizeNamespace(entry) !==
                          normalizeNamespace(namespace),
                      ),
                ),
              }
            : c,
        );
        const updatedAzure = currentSettings.azureOrganizations.map((c) =>
          c.id === connectionId && provider === "azure-devops"
            ? {
                ...c,
                excludeProjectsFromLoading: uniqueNamespaces(
                  excluded
                    ? [...(c.excludeProjectsFromLoading ?? []), namespace]
                    : (c.excludeProjectsFromLoading ?? []).filter(
                        (entry) =>
                          normalizeNamespace(entry) !==
                          normalizeNamespace(namespace),
                      ),
                ),
              }
            : c,
        );

        currentSettings = {
          ...currentSettings,
          githubConnections: updatedGithub,
          azureOrganizations: updatedAzure,
        };

        void window.ctrlApi
          .saveProjectConfig({
            githubConnections: updatedGithub,
            azureOrganizations: updatedAzure,
          })
          .then(() => {
            renderStatus(
              `${excluded ? "Excluded" : "Included"} ${provider === "github" ? "organization" : "project"} "${namespace}" ${excluded ? "from" : "for"} loading. Saved to ctrl.config.json.`,
              "success",
            );
            renderNamespaceToggles(currentSettings!, currentRepositories);
            void refreshRepositories();
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : "Save failed.";
            renderStatus(message, "error");
          });
      });
    });
}

function renderStatus(
  message: string,
  state: "success" | "error" | "neutral" = "neutral",
): void {
  requiredSettingsStatus.textContent = message;
  requiredSettingsStatus.className = `status status-${state}`;
}

function providerLabel(provider: Provider): string {
  return provider === "github" ? "GitHub" : "Azure DevOps";
}

function countLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return String(value);
}

function hasKnownActivityMetrics(repository: RepositorySummary): boolean {
  return (
    repository.openIssues !== null &&
    repository.openIssues !== undefined &&
    repository.openPullRequests !== null &&
    repository.openPullRequests !== undefined
  );
}

function hasPositiveActivity(repository: RepositorySummary): boolean {
  return (
    (repository.openIssues ?? 0) > 0 || (repository.openPullRequests ?? 0) > 0
  );
}

function hasUnreadNotifications(repository: RepositorySummary): boolean {
  return (repository.unreadNotifications ?? 0) > 0;
}

function getFilterLabel(): string {
  if (filterMode === "issues") {
    return "issues";
  }

  if (filterMode === "prs") {
    return "prs";
  }

  if (filterMode === "notifications") {
    return "notifications";
  }

  return "all";
}

function syncFilterButtons(): void {
  requiredFilterIssuesButton.classList.toggle(
    "active",
    filterMode === "issues",
  );
  requiredFilterPrsButton.classList.toggle("active", filterMode === "prs");
  requiredFilterNotificationsButton.classList.toggle(
    "active",
    filterMode === "notifications",
  );
}

function renderRepositorySummary(
  repositories: RepositorySummary[],
  visibleRepositories: RepositorySummary[],
): void {
  const activeRepositories = repositories.filter(hasPositiveActivity).length;
  const unreadRepositories = repositories.filter(hasUnreadNotifications).length;
  const unreadNotifications = repositories.reduce(
    (total, repository) => total + (repository.unreadNotifications ?? 0),
    0,
  );
  const liveRepositories = repositories.filter(
    (repository) => repository.dataSource === "live",
  ).length;
  const unknownActivity = repositories.filter(
    (repository) => !hasKnownActivityMetrics(repository),
  ).length;

  requiredRepoSummary.innerHTML = `
    <article class="summary-card">
      <span class="summary-label">Visible Repositories</span>
      <strong>${visibleRepositories.length}</strong>
      <p>${filterMode === "all" ? "current workspace view" : `filtered by ${getFilterLabel()}`}</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">Issues / PRs</span>
      <strong>${activeRepositories}</strong>
      <p>open issues or pull requests</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">Unread Notifications</span>
      <strong>${unreadNotifications}</strong>
      <p>${unreadRepositories} repositories with unread GitHub notifications</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">Live Data Coverage</span>
      <strong>${liveRepositories}/${repositories.length}</strong>
      <p>${unknownActivity} repositories still resolving activity</p>
    </article>
  `;
}

function formatAge(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "n/a";
  }

  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}

function renderDebugState(debugState: RepositoryDebugState): void {
  requiredDebugRefresh.textContent = debugState.lastLiveRefreshAt
    ? `Last live refresh: ${formatTimestamp(debugState.lastLiveRefreshAt)}`
    : "No live refresh yet";
  requiredDebugCachePath.textContent = `Cache file: ${debugState.cacheFilePath}`;

  requiredDebugList.innerHTML = debugState.sources
    .map(
      (source) => `
        <article class="debug-card">
          <h3>${escapedHtml(source.sourceLabel)}</h3>
          <p>${escapedHtml(providerLabel(source.provider))} · status: ${escapedHtml(source.lastFetchStatus)}</p>
          <div class="insights-row">
            <span class="tag">Repos: ${source.repositoryCount}</span>
            <span class="tag">Cache age: ${escapedHtml(formatAge(source.cacheAgeSeconds))}</span>
            <span class="tag">Cache updated: ${escapedHtml(formatTimestamp(source.cacheUpdatedAt))}</span>
            <span class="tag">Last fetch: ${escapedHtml(formatTimestamp(source.lastFetchAt))}</span>
          </div>
          ${source.lastError ? `<p class="debug-error">${escapedHtml(source.lastError)}</p>` : ""}
        </article>
      `,
    )
    .join("");
}

function escapedHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface RepositoryGroup {
  key: string;
  title: string;
  subtitle: string;
  repositories: RepositorySummary[];
}

interface RepositoryNamespaceGroup {
  key: string;
  label: string;
  repositories: RepositorySummary[];
}

function parseHostname(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

function githubEnterpriseFromApiBase(
  apiBaseUrl: string | undefined,
): string | null {
  const host = parseHostname(apiBaseUrl);
  if (!host || host === "api.github.com") {
    return null;
  }

  return host;
}

function azureOrganizationFromUrl(
  organizationUrl: string | undefined,
): string | null {
  if (!organizationUrl) {
    return null;
  }

  try {
    const parsed = new URL(organizationUrl);
    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (host === "dev.azure.com" && segments.length > 0) {
      return segments[0];
    }

    if (host.endsWith(".visualstudio.com")) {
      return host.replace(/\.visualstudio\.com$/, "");
    }

    return segments[0] ?? host;
  } catch {
    return null;
  }
}

function getGitHubOrganization(repository: RepositorySummary): string | null {
  if (repository.githubOwnerType === "Organization") {
    return (
      repository.githubOwnerLogin ?? repository.fullName.split("/")[0] ?? null
    );
  }

  return null;
}

function groupRepositories(
  repositories: RepositorySummary[],
): RepositoryGroup[] {
  const groups = new Map<string, RepositoryGroup>();

  for (const repository of repositories) {
    const title = repository.sourceLabel || repository.sourceId;
    const enterprise =
      repository.provider === "github"
        ? githubEnterpriseFromApiBase(repository.githubApiBaseUrl)
        : null;
    const subtitle = enterprise
      ? `${providerLabel(repository.provider)} · ${enterprise}`
      : providerLabel(repository.provider);
    const key = `${repository.provider}:${repository.sourceId}`;
    const existingGroup = groups.get(key);
    if (!existingGroup) {
      groups.set(key, {
        key,
        title,
        subtitle,
        repositories: [repository],
      });
      continue;
    }

    existingGroup.repositories.push(repository);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      repositories: group.repositories.sort((left, right) =>
        left.fullName.localeCompare(right.fullName),
      ),
    }))
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        left.subtitle.localeCompare(right.subtitle),
    );
}

function getGroupMetrics(group: RepositoryGroup): {
  totalIssues: number;
  totalPRs: number;
  totalNotifications: number;
} {
  return group.repositories.reduce(
    (acc, repo) => ({
      totalIssues: acc.totalIssues + (repo.openIssues ?? 0),
      totalPRs: acc.totalPRs + (repo.openPullRequests ?? 0),
      totalNotifications:
        acc.totalNotifications + (repo.unreadNotifications ?? 0),
    }),
    { totalIssues: 0, totalPRs: 0, totalNotifications: 0 },
  );
}

function hasOpenIssues(repo: RepositorySummary): boolean {
  return (repo.openIssues ?? 0) > 0;
}

function hasOpenPrs(repo: RepositorySummary): boolean {
  return (repo.openPullRequests ?? 0) > 0;
}

function shouldDisplayRepository(repo: RepositorySummary): boolean {
  if (filterMode === "all") {
    return true;
  }

  if (filterMode === "issues") {
    return hasOpenIssues(repo);
  }

  if (filterMode === "prs") {
    return hasOpenPrs(repo);
  }

  return hasUnreadNotifications(repo);
}

function getRepositoryNamespace(repository: RepositorySummary): string {
  if (repository.provider === "github") {
    return (
      getGitHubOrganization(repository) ??
      (repository.fullName.includes("/")
        ? repository.fullName.split("/")[0]
        : "personal")
    );
  }

  if (repository.project) {
    return repository.project;
  }

  if (repository.fullName.includes("/")) {
    return repository.fullName.split("/")[0];
  }

  return "unassigned";
}

function groupRepositoriesByNamespace(
  group: RepositoryGroup,
): RepositoryNamespaceGroup[] {
  const namespaces = new Map<string, RepositoryNamespaceGroup>();

  for (const repository of group.repositories) {
    const label = getRepositoryNamespace(repository);
    const key = `${group.key}:${label}`;
    const existingNamespace = namespaces.get(key);
    if (!existingNamespace) {
      namespaces.set(key, {
        key,
        label,
        repositories: [repository],
      });
      continue;
    }

    existingNamespace.repositories.push(repository);
  }

  return Array.from(namespaces.values())
    .map((namespace) => ({
      ...namespace,
      repositories: namespace.repositories.sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function cloneRepository(repository: RepositorySummary): Promise<void> {
  try {
    const result = (await window.ctrlApi.cloneRepository({
      repository,
    })) as CloneResult;
    const verb = result.alreadyExists ? "already available" : "cloned";
    renderStatus(
      `${repository.fullName} ${verb} at ${result.localPath}.`,
      "success",
    );
    await refreshRepositories({ suppressStatus: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clone failed.";
    renderStatus(`Could not clone ${repository.fullName}: ${message}`, "error");
  }
}

async function analyzeRepository(repository: RepositorySummary): Promise<void> {
  try {
    const result = (await window.ctrlApi.analyzeRepository(
      repository,
    )) as AnalyzeRepositoryDescriptionResult;

    if (result.remoteUpdated) {
      renderStatus(
        `${repository.fullName} description updated locally and synced to ${providerLabel(repository.provider)}: ${result.description}`,
        "success",
      );
    } else {
      renderStatus(
        `${repository.fullName} description updated locally, but remote sync failed: ${result.remoteError || "unknown error"}`,
        "error",
      );
    }

    await refreshRepositories();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analyze failed.";
    renderStatus(
      `Could not analyze ${repository.fullName}: ${message}`,
      "error",
    );
  }
}

function renderRepositories(repositories: RepositorySummary[]): void {
  currentRepositories = repositories;
  if (currentSettings) {
    renderNamespaceToggles(currentSettings, repositories);
  }

  if (repositories.length === 0) {
    requiredRepoCount.textContent = "0 repositories";
    requiredRepoSummary.innerHTML = "";
    requiredRepoList.innerHTML =
      '<p class="empty">No repositories found. Configure connections and refresh.</p>';
    return;
  }

  const visibleRepositories = repositories.filter(shouldDisplayRepository);
  requiredRepoCount.textContent =
    filterMode === "all"
      ? `${repositories.length} repositories`
      : `${visibleRepositories.length} visible · ${repositories.length} total`;
  renderRepositorySummary(repositories, visibleRepositories);

  if (filterMode !== "all" && visibleRepositories.length === 0) {
    requiredRepoList.innerHTML =
      '<p class="empty">No repositories matched the current filter. Re-run a live refresh if you expect recent GitHub activity or unread notifications.</p>';
    return;
  }

  const groups = groupRepositories(repositories);

  requiredRepoList.innerHTML = groups
    .map((group) => {
      const metrics = getGroupMetrics(group);
      const visibleRepos = group.repositories.filter(shouldDisplayRepository);
      if (filterMode !== "all" && visibleRepos.length === 0) {
        return "";
      }
      const openAttr = collapsedGroupKeys.has(group.key) ? "" : " open";
      const namespaces = groupRepositoriesByNamespace(group);
      return `
        <details class="repo-group" data-group-key="${escapedHtml(group.key)}"${openAttr}>
          <summary class="repo-group-header">
            <div class="repo-group-heading">
              <h3>${escapedHtml(group.title)}</h3>
              <p class="repo-group-subtitle">${escapedHtml(group.subtitle)}</p>
            </div>
            <div class="repo-group-stats">
              <span class="stat-badge">Issues ${metrics.totalIssues}</span>
              <span class="stat-badge">PRs ${metrics.totalPRs}</span>
              <span class="stat-badge">Unread ${metrics.totalNotifications}</span>
              <span class="stat-badge stat-badge-muted">Repos ${visibleRepos.length}/${group.repositories.length}</span>
            </div>
          </summary>
          <div class="repo-tree-wrap">
            <ul class="repo-tree">
              ${namespaces
                .map((namespace) => {
                  const namespaceRepos =
                    filterMode !== "all"
                      ? namespace.repositories.filter(shouldDisplayRepository)
                      : namespace.repositories;
                  if (filterMode !== "all" && namespaceRepos.length === 0) {
                    return "";
                  }
                  const namespaceOpenAttr = collapsedNamespaceKeys.has(
                    namespace.key,
                  )
                    ? ""
                    : " open";
                  const nsIssues = namespaceRepos.reduce(
                    (sum, r) => sum + (r.openIssues ?? 0),
                    0,
                  );
                  const nsPrs = namespaceRepos.reduce(
                    (sum, r) => sum + (r.openPullRequests ?? 0),
                    0,
                  );
                  const nsUnread = namespaceRepos.reduce(
                    (sum, r) => sum + (r.unreadNotifications ?? 0),
                    0,
                  );
                  return `
                    <li class="repo-tree-node">
                      <details class="namespace-node" data-namespace-key="${escapedHtml(namespace.key)}"${namespaceOpenAttr}>
                        <summary class="namespace-header">
                          <span class="namespace-label">${escapedHtml(namespace.label)}</span>
                          <div class="namespace-stats">
                            ${nsIssues > 0 ? `<span class="ns-badge">Issues ${nsIssues}</span>` : ""}
                            ${nsPrs > 0 ? `<span class="ns-badge">PRs ${nsPrs}</span>` : ""}
                            ${nsUnread > 0 ? `<span class="ns-badge ns-badge-unread">Unread ${nsUnread}</span>` : ""}
                            <span class="namespace-count">${namespaceRepos.length}</span>
                          </div>
                        </summary>
                        <ul class="repo-leaf-list">
                          ${namespaceRepos
                            .map((repo) => {
                              const cloneState = repo.isCloned
                                ? "cloned"
                                : "not cloned";
                              const branch = repo.localBranch ?? "n/a";
                              const issues = countLabel(repo.openIssues);
                              const prs = countLabel(repo.openPullRequests);
                              const unread = countLabel(
                                repo.unreadNotifications,
                              );
                              const cacheAge = formatAge(repo.cacheAgeSeconds);
                              const dataSource = repo.dataSource ?? "live";
                              const tooltip = escapedHtml(
                                repo.description?.trim() ||
                                  "No description available",
                              );
                              return `
                                <li class="repo-leaf">
                                  <div class="repo-leaf-main">
                                    <a href="${escapedHtml(repo.webUrl)}" target="_blank" rel="noreferrer" title="${tooltip}">${escapedHtml(repo.name)}</a>
                                    <div class="repo-leaf-meta">
                                      ${repo.project ? `<span class="tag">project: ${escapedHtml(repo.project)}</span>` : ""}
                                      <span class="tag">${escapedHtml(repo.visibility)}</span>
                                      <span class="tag">default: ${escapedHtml(repo.defaultBranch)}</span>
                                      <span class="tag ${repo.isCloned ? "tag-good" : "tag-warn"}">${cloneState}</span>
                                      <span class="tag">branch: ${escapedHtml(branch)}</span>
                                      <span class="tag">issues: ${issues}</span>
                                      <span class="tag">prs: ${prs}</span>
                                      <span class="tag">unread: ${unread}</span>
                                      <span class="tag">data: ${escapedHtml(dataSource)}</span>
                                      <span class="tag">cache: ${escapedHtml(cacheAge)}</span>
                                    </div>
                                    <span class="repo-path">${escapedHtml(repo.localPath ?? "")}</span>
                                  </div>
                                  <div class="repo-actions">
                                    <button class="analyze-btn" data-repo-id="${escapedHtml(repo.id)}">Analyze</button>
                                    <button class="clone-btn" data-repo-id="${escapedHtml(repo.id)}">${repo.isCloned ? "Re-checkout" : "Clone"}</button>
                                  </div>
                                </li>
                              `;
                            })
                            .join("")}
                        </ul>
                      </details>
                    </li>
                  `;
                })
                .join("")}
            </ul>
          </div>
        </details>
      `;
    })
    .join("");

  for (const groupElement of requiredRepoList.querySelectorAll<HTMLDetailsElement>(
    ".repo-group",
  )) {
    const key = groupElement.dataset.groupKey;
    if (!key) {
      continue;
    }

    groupElement.addEventListener("toggle", () => {
      if (groupElement.open) {
        collapsedGroupKeys.delete(key);
      } else {
        collapsedGroupKeys.add(key);
      }
    });
  }

  for (const namespaceElement of requiredRepoList.querySelectorAll<HTMLDetailsElement>(
    ".namespace-node",
  )) {
    const key = namespaceElement.dataset.namespaceKey;
    if (!key) {
      continue;
    }

    namespaceElement.addEventListener("toggle", () => {
      if (namespaceElement.open) {
        collapsedNamespaceKeys.delete(key);
      } else {
        collapsedNamespaceKeys.add(key);
      }
    });
  }

  for (const button of requiredRepoList.querySelectorAll<HTMLButtonElement>(
    ".clone-btn",
  )) {
    button.addEventListener("click", async () => {
      const repository = repositories.find(
        (repo) => repo.id === button.dataset.repoId,
      );
      if (!repository) {
        return;
      }

      button.disabled = true;
      button.textContent = "Working...";

      await cloneRepository(repository);

      button.disabled = false;
      button.textContent = repository.isCloned ? "Re-checkout" : "Clone";
    });
  }

  for (const button of requiredRepoList.querySelectorAll<HTMLButtonElement>(
    ".analyze-btn",
  )) {
    button.addEventListener("click", async () => {
      const repository = repositories.find(
        (repo) => repo.id === button.dataset.repoId,
      );
      if (!repository) {
        return;
      }

      button.disabled = true;
      button.textContent = "Analyzing...";

      await analyzeRepository(repository);

      button.disabled = false;
      button.textContent = "Analyze";
    });
  }
}

async function refreshRepositories(options?: {
  suppressStatus?: boolean;
}): Promise<void> {
  try {
    if (!options?.suppressStatus) {
      renderStatus("Refreshing repositories and insights...", "neutral");
    }
    const repositories = await window.ctrlApi.listRepositories();
    renderRepositories(repositories);
    if (!options?.suppressStatus) {
      renderStatus(
        `Loaded ${repositories.length} repositories with local and remote insights.`,
        "success",
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not fetch repositories.";
    renderStatus(message, "error");
  }
}

async function forceRefreshRepositories(): Promise<void> {
  try {
    renderStatus("Refreshing live sources...", "neutral");
    const repositories = await window.ctrlApi.refreshRepositories();
    renderRepositories(repositories);
    renderStatus(
      `Live refresh completed with ${repositories.length} repositories.`,
      "success",
    );
    renderDebugState(await window.ctrlApi.getRepositoryDebugState());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not refresh repositories.";
    renderStatus(message, "error");
  }
}

function setTreeOpenState(open: boolean): void {
  const groupNodes =
    requiredRepoList.querySelectorAll<HTMLDetailsElement>(".repo-group");
  const namespaceNodes =
    requiredRepoList.querySelectorAll<HTMLDetailsElement>(".namespace-node");

  if (open) {
    collapsedGroupKeys.clear();
    collapsedNamespaceKeys.clear();
  }

  for (const node of groupNodes) {
    const key = node.dataset.groupKey;
    if (!key) {
      continue;
    }

    node.open = open;
    if (!open) {
      collapsedGroupKeys.add(key);
    }
  }

  for (const node of namespaceNodes) {
    const key = node.dataset.namespaceKey;
    if (!key) {
      continue;
    }

    node.open = open;
    if (!open) {
      collapsedNamespaceKeys.add(key);
    }
  }
}

requiredExpandAllButton.addEventListener("click", () => {
  setTreeOpenState(true);
});

requiredCollapseAllButton.addEventListener("click", () => {
  setTreeOpenState(false);
});

requiredFilterIssuesButton.addEventListener("click", () => {
  filterMode = filterMode === "issues" ? "all" : "issues";
  syncFilterButtons();
  void refreshRepositories();
});

requiredFilterPrsButton.addEventListener("click", () => {
  filterMode = filterMode === "prs" ? "all" : "prs";
  syncFilterButtons();
  void refreshRepositories();
});

requiredFilterNotificationsButton.addEventListener("click", () => {
  filterMode = filterMode === "notifications" ? "all" : "notifications";
  syncFilterButtons();
  void refreshRepositories();
});

requiredForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const nextSettings = settingsFromForm();
    const saved = await window.ctrlApi.saveSettings(nextSettings);
    assignSettings(saved);
    renderStatus("Settings saved.", "success");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save settings.";
    renderStatus(message, "error");
  }
});

const refreshButton =
  document.querySelector<HTMLButtonElement>("#refresh-repos");
const refreshTopButton =
  document.querySelector<HTMLButtonElement>("#refresh-repos-top");

requireElement(refreshButton, "#refresh-repos").addEventListener(
  "click",
  async () => {
    await forceRefreshRepositories();
  },
);

requireElement(refreshTopButton, "#refresh-repos-top").addEventListener(
  "click",
  async () => {
    await forceRefreshRepositories();
  },
);

window.ctrlApi.onRepositoriesUpdated((repositories) => {
  renderRepositories(repositories);
  renderStatus(
    `Background refresh updated ${repositories.length} repositories from live sources.`,
    "success",
  );
});

window.ctrlApi.onDebugUpdated((debugState) => {
  renderDebugState(debugState);
});

window.ctrlApi.onConfigChanged(async () => {
  try {
    const latestSettings = await window.ctrlApi.getSettings();
    assignSettings(latestSettings);
    await refreshRepositories();
    renderDebugState(await window.ctrlApi.getRepositoryDebugState());
    renderStatus("Configuration reloaded from ctrl.config.json.", "success");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to reload configuration.";
    renderStatus(message, "error");
  }
});

async function init(): Promise<void> {
  const settings = await window.ctrlApi.getSettings();
  assignSettings(settings);
  await refreshRepositories();
  renderDebugState(await window.ctrlApi.getRepositoryDebugState());
}

void init();
