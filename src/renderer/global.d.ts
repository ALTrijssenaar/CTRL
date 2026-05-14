type Provider = "github" | "azure-devops";
type RepositoryDataSource = "cache" | "live";
type RepositoryFetchStatus =
  | "idle"
  | "cache-hit"
  | "cache-miss"
  | "refreshing"
  | "success"
  | "fallback"
  | "error"
  | "skipped";

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
  dataSource?: RepositoryDataSource;
  agenticWorkflowEnabled?: boolean;
  copilotAgentActive?: boolean | null;
  copilotInteractionsLastMonth?: number | null;
  copilotInteractionsCurrentMonth?: number | null;
}

interface RepositorySourceDebugState {
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

interface CloneRequest {
  repository: RepositorySummary;
  targetDirectory?: string;
}

interface CloneResult {
  localPath: string;
  alreadyExists: boolean;
}

interface AnalyzeRepositoryDescriptionResult {
  description: string;
}

interface CtrlApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  saveProjectConfig: (
    partial: Pick<AppSettings, "githubConnections" | "azureOrganizations">,
  ) => Promise<void>;
  listRepositories: () => Promise<RepositorySummary[]>;
  refreshRepositories: () => Promise<RepositorySummary[]>;
  getRepositoryDebugState: () => Promise<RepositoryDebugState>;
  cloneRepository: (request: CloneRequest) => Promise<CloneResult>;
  analyzeRepository: (
    repository: RepositorySummary,
  ) => Promise<AnalyzeRepositoryDescriptionResult>;
  toggleAgenticWorkflow: (
    repoFullName: string,
    enabled: boolean,
  ) => Promise<RepositorySummary[]>;
  onConfigChanged: (listener: () => void) => () => void;
  onRepositoriesUpdated: (
    listener: (repositories: RepositorySummary[]) => void,
  ) => () => void;
  onDebugUpdated: (
    listener: (debugState: RepositoryDebugState) => void,
  ) => () => void;
}

declare global {
  interface Window {
    ctrlApi: CtrlApi;
  }
}

export {};
