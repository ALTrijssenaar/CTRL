export type Provider = "github" | "azure-devops";
export type RepositoryDataSource = "cache" | "live";
export type RepositoryFetchStatus =
  | "idle"
  | "cache-hit"
  | "cache-miss"
  | "refreshing"
  | "success"
  | "fallback"
  | "error"
  | "skipped";

export interface GitHubConnection {
  id: string;
  apiBaseUrl: string;
  token: string;
  tokenEnvVar: string;
  excludeFromLiveRefresh?: boolean;
  excludeOrganizationsFromLoading?: string[];
}

export interface AzureOrganizationConnection {
  id: string;
  organizationUrl: string;
  pat: string;
  patEnvVar: string;
  excludeFromLiveRefresh?: boolean;
  excludeProjectsFromLoading?: string[];
}

export interface RepositorySummary {
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
  dataSource?: RepositoryDataSource;
  agenticWorkflowEnabled?: boolean;
  copilotAgentActive?: boolean | null;
  copilotInteractionsLastMonth?: number | null;
  copilotInteractionsCurrentMonth?: number | null;
}

export interface RepositorySourceDebugState {
  provider: Provider;
  sourceId: string;
  sourceLabel: string;
  repositoryCount: number;
  cacheUpdatedAt: number | null;
  cacheAgeSeconds: number | null;
  lastFetchStatus: RepositoryFetchStatus;
  lastFetchAt: number | null;
  lastError: string | null;
}

export interface RepositoryDebugState {
  cacheFilePath: string;
  lastLiveRefreshAt: number | null;
  sources: RepositorySourceDebugState[];
}

export interface AppSettings {
  githubConnections: GitHubConnection[];
  azureOrganizations: AzureOrganizationConnection[];
  cloneBasePath: string;
  agenticWorkflowEnabledRepos?: string[];
}

export interface CloneRequest {
  repository: RepositorySummary;
  targetDirectory?: string;
}

export interface CloneResult {
  localPath: string;
  alreadyExists: boolean;
}

export interface AnalyzeRepositoryDescriptionRequest {
  repository: RepositorySummary;
}

export interface AnalyzeRepositoryDescriptionResult {
  description: string;
  remoteUpdated: boolean;
  remoteError?: string;
}
