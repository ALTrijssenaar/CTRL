import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import simpleGit from "simple-git";
import { AppSettings, RepositorySummary } from "../types/repository";
import { resolveRepositoryLocalPath } from "./git-service";
import { resolveAzurePat, resolveGitHubToken } from "./settings-store";

interface EnrichmentOptions {
  includeRemoteMetrics: boolean;
}

interface GitHubSearchResponse {
  total_count: number;
}

interface GitHubGraphqlResponse {
  data?: {
    repository?: {
      issues?: { totalCount: number };
      pullRequests?: { totalCount: number };
    } | null;
  };
}

interface GitHubNotificationItem {
  unread?: boolean;
  repository?: {
    full_name?: string;
  };
}

interface AzurePullRequestsResponse {
  count: number;
}

const GRAPHQL_TIMEOUT_COOLDOWN_MS = 5 * 60 * 1000;
const GRAPHQL_METRICS_CONCURRENCY = 8;
const graphqlTimeoutSuppressUntilByApi = new Map<string, number>();
const graphqlTimeoutNoticeLoggedByApi = new Set<string>();
const restFallbackSuppressUntilByApi = new Map<string, number>();
const restFallbackNoticeLoggedByApi = new Set<string>();

interface GitHubSearchErrorResponse {
  message?: string;
}

interface GitHubRestFallbackErrorInfo {
  isTimeout: boolean;
  isForbidden: boolean;
  isSearchRateLimit: boolean;
  message: string;
  rateLimitResetEpochSeconds: number | null;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function getGitHubGraphqlUrl(apiBaseUrl: string): string {
  if (apiBaseUrl === "https://api.github.com") {
    return `${apiBaseUrl}/graphql`;
  }

  return apiBaseUrl.replace(/\/api\/v3$/i, "/api/graphql");
}

function getGitHubRestFallbackErrorInfo(
  error: unknown,
): GitHubRestFallbackErrorInfo {
  const defaultInfo: GitHubRestFallbackErrorInfo = {
    isTimeout: false,
    isForbidden: false,
    isSearchRateLimit: false,
    message: error instanceof Error ? error.message : String(error),
    rateLimitResetEpochSeconds: null,
  };

  if (!axios.isAxiosError(error)) {
    return defaultInfo;
  }

  const status = error.response?.status;
  const headers = error.response?.headers ?? {};
  const responseData = error.response?.data as
    | GitHubSearchErrorResponse
    | undefined;
  const remaining =
    typeof headers["x-ratelimit-remaining"] === "string"
      ? headers["x-ratelimit-remaining"]
      : Array.isArray(headers["x-ratelimit-remaining"])
        ? headers["x-ratelimit-remaining"][0]
        : null;
  const resource =
    typeof headers["x-ratelimit-resource"] === "string"
      ? headers["x-ratelimit-resource"]
      : Array.isArray(headers["x-ratelimit-resource"])
        ? headers["x-ratelimit-resource"][0]
        : null;
  const resetHeader =
    typeof headers["x-ratelimit-reset"] === "string"
      ? headers["x-ratelimit-reset"]
      : Array.isArray(headers["x-ratelimit-reset"])
        ? headers["x-ratelimit-reset"][0]
        : null;
  const rateLimitResetEpochSeconds =
    resetHeader && /^\d+$/.test(resetHeader)
      ? Number.parseInt(resetHeader, 10)
      : null;
  const responseMessage = responseData?.message;

  return {
    isTimeout: error.code === "ECONNABORTED",
    isForbidden: status === 403,
    isSearchRateLimit:
      status === 403 &&
      remaining === "0" &&
      (resource === "search" ||
        responseMessage?.toLowerCase().includes("rate limit") === true),
    message: responseMessage || error.message,
    rateLimitResetEpochSeconds,
  };
}

function formatRateLimitResetTime(epochSeconds: number | null): string {
  if (!epochSeconds) {
    return "unknown reset time";
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function splitFullName(
  fullName: string,
): { owner: string; name: string } | null {
  const separator = fullName.indexOf("/");
  if (separator <= 0 || separator === fullName.length - 1) {
    return null;
  }

  return {
    owner: fullName.slice(0, separator),
    name: fullName.slice(separator + 1),
  };
}

async function getGitHubIssueAndPrCountsFromGraphql(
  fullName: string,
  apiBaseUrl: string,
  token: string,
): Promise<{ openIssues: number | null; openPullRequests: number | null }> {
  const parts = splitFullName(fullName);
  if (!parts) {
    return { openIssues: null, openPullRequests: null };
  }

  const response = await axios.post<GitHubGraphqlResponse>(
    getGitHubGraphqlUrl(apiBaseUrl),
    {
      query: `query RepositoryActivity($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          issues(states: OPEN) {
            totalCount
          }
          pullRequests(states: OPEN) {
            totalCount
          }
        }
      }`,
      variables: parts,
    },
    {
      headers: githubHeaders(token),
      timeout: 8000,
    },
  );

  return {
    openIssues: response.data.data?.repository?.issues?.totalCount ?? null,
    openPullRequests:
      response.data.data?.repository?.pullRequests?.totalCount ?? null,
  };
}

async function getGitHubIssueAndPrCountsFromSearch(
  fullName: string,
  apiBaseUrl: string,
  token: string,
): Promise<{ openIssues: number | null; openPullRequests: number | null }> {
  const [issuesResponse, prsResponse] = await Promise.all([
    axios.get<GitHubSearchResponse>(`${apiBaseUrl}/search/issues`, {
      headers: githubHeaders(token),
      params: { q: `repo:${fullName} type:issue state:open` },
      timeout: 8000,
    }),
    axios.get<GitHubSearchResponse>(`${apiBaseUrl}/search/issues`, {
      headers: githubHeaders(token),
      params: { q: `repo:${fullName} type:pr state:open` },
      timeout: 8000,
    }),
  ]);

  return {
    openIssues: issuesResponse.data.total_count,
    openPullRequests: prsResponse.data.total_count,
  };
}

async function getGitHubIssueAndPrCounts(
  fullName: string,
  apiBaseUrl: string,
  token: string,
): Promise<{ openIssues: number | null; openPullRequests: number | null }> {
  if (!token) {
    return { openIssues: null, openPullRequests: null };
  }

  const restSuppressUntil = restFallbackSuppressUntilByApi.get(apiBaseUrl) ?? 0;
  const nowForRestSuppression = Date.now();
  if (nowForRestSuppression >= restSuppressUntil) {
    restFallbackNoticeLoggedByApi.delete(apiBaseUrl);
  }

  if (nowForRestSuppression < restSuppressUntil) {
    return { openIssues: null, openPullRequests: null };
  }

  const cooldownUntil = graphqlTimeoutSuppressUntilByApi.get(apiBaseUrl) ?? 0;
  const now = Date.now();
  if (now >= cooldownUntil) {
    try {
      const graphqlCounts = await getGitHubIssueAndPrCountsFromGraphql(
        fullName,
        apiBaseUrl,
        token,
      );

      if (
        graphqlCounts.openIssues !== null &&
        graphqlCounts.openPullRequests !== null
      ) {
        graphqlTimeoutNoticeLoggedByApi.delete(apiBaseUrl);
        return graphqlCounts;
      }
    } catch (error) {
      const isTimeout =
        axios.isAxiosError(error) && error.code === "ECONNABORTED";

      if (isTimeout) {
        graphqlTimeoutSuppressUntilByApi.set(
          apiBaseUrl,
          Date.now() + GRAPHQL_TIMEOUT_COOLDOWN_MS,
        );
        if (!graphqlTimeoutNoticeLoggedByApi.has(apiBaseUrl)) {
          console.warn(
            `[github] GraphQL metrics timed out for ${apiBaseUrl}; temporarily falling back to REST search for 5 minutes.`,
          );
          graphqlTimeoutNoticeLoggedByApi.add(apiBaseUrl);
        }
      } else {
        console.warn(
          `[github] GraphQL metrics failed; falling back to REST search: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Fall through to REST search for unavailable or slow GraphQL endpoints.
    }
  }

  try {
    return await getGitHubIssueAndPrCountsFromSearch(
      fullName,
      apiBaseUrl,
      token,
    );
  } catch (error) {
    const errorInfo = getGitHubRestFallbackErrorInfo(error);
    if (errorInfo.isForbidden) {
      restFallbackSuppressUntilByApi.set(
        apiBaseUrl,
        Date.now() + GRAPHQL_TIMEOUT_COOLDOWN_MS,
      );

      if (!restFallbackNoticeLoggedByApi.has(apiBaseUrl)) {
        if (errorInfo.isSearchRateLimit) {
          console.warn(
            `[github] REST metrics fallback rate-limited for ${apiBaseUrl}; using cached metrics for 5 minutes (reset ${formatRateLimitResetTime(errorInfo.rateLimitResetEpochSeconds)}).`,
          );
        } else {
          console.warn(
            `[github] REST metrics fallback forbidden for ${apiBaseUrl}; using cached metrics for 5 minutes (${errorInfo.message}).`,
          );
        }
        restFallbackNoticeLoggedByApi.add(apiBaseUrl);
      }

      return { openIssues: null, openPullRequests: null };
    }

    if (!errorInfo.isTimeout) {
      console.warn(
        `[github] REST metrics fallback failed for ${fullName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { openIssues: null, openPullRequests: null };
  }
}

async function getGitHubUnreadNotificationCounts(
  apiBaseUrl: string,
  token: string,
): Promise<Map<string, number> | null> {
  if (!token) {
    return null;
  }

  const counts = new Map<string, number>();

  try {
    for (let page = 1; page <= 10; page += 1) {
      const response = await axios.get<GitHubNotificationItem[]>(
        `${apiBaseUrl}/notifications`,
        {
          headers: githubHeaders(token),
          params: {
            all: false,
            participating: false,
            per_page: 100,
            page,
          },
          timeout: 8000,
        },
      );

      if (response.data.length === 0) {
        break;
      }

      for (const item of response.data) {
        const fullName = item.repository?.full_name;
        if (!fullName || item.unread === false) {
          continue;
        }

        counts.set(fullName, (counts.get(fullName) ?? 0) + 1);
      }
    }

    return counts;
  } catch {
    return null;
  }
}

function toBasicAuthHeader(pat: string): string {
  const encoded = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function getAzurePrCount(
  repository: RepositorySummary,
  settings: AppSettings,
): Promise<number | null> {
  if (!repository.project || !repository.azureOrganizationUrl) {
    return null;
  }

  const connection = settings.azureOrganizations.find(
    (entry) => entry.id === repository.sourceId,
  );
  if (!connection) {
    return null;
  }

  const pat = resolveAzurePat(connection);
  if (!pat) {
    return null;
  }

  const normalizedOrgUrl = repository.azureOrganizationUrl.replace(/\/$/, "");
  const repositoryId = repository.id.replace(/^azure-/, "");

  try {
    const response = await axios.get<AzurePullRequestsResponse>(
      `${normalizedOrgUrl}/${encodeURIComponent(repository.project)}/_apis/git/repositories/${repositoryId}/pullrequests`,
      {
        headers: {
          Authorization: toBasicAuthHeader(pat),
        },
        params: {
          "searchCriteria.status": "active",
          "api-version": "7.1-preview.1",
          $top: 1,
        },
        timeout: 5000,
      },
    );

    return response.data.count;
  } catch {
    return null;
  }
}

async function getLocalRepositoryState(
  localPath: string,
): Promise<{ isCloned: boolean; localBranch: string | null }> {
  try {
    await fs.access(path.join(localPath, ".git"));
    const git = simpleGit(localPath);
    const branchSummary = await git.branchLocal();
    return {
      isCloned: true,
      localBranch: branchSummary.current || null,
    };
  } catch {
    return {
      isCloned: false,
      localBranch: null,
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const concurrency = Math.max(1, limit);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) {
          return;
        }

        results[currentIndex] = await mapper(items[currentIndex]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export async function enrichRepositoriesWithInsights(
  repositories: RepositorySummary[],
  settings: AppSettings,
  options: EnrichmentOptions = { includeRemoteMetrics: true },
): Promise<RepositorySummary[]> {
  const githubNotificationCountsBySource = new Map<
    string,
    Map<string, number> | null
  >();

  if (options.includeRemoteMetrics) {
    await Promise.all(
      settings.githubConnections.map(async (connection) => {
        const token = resolveGitHubToken(connection);
        const counts = await getGitHubUnreadNotificationCounts(
          connection.apiBaseUrl || "https://api.github.com",
          token,
        );
        githubNotificationCountsBySource.set(connection.id, counts);
      }),
    );
  }

  return mapWithConcurrency(
    repositories,
    GRAPHQL_METRICS_CONCURRENCY,
    async (repository) => {
      const localPath = resolveRepositoryLocalPath(
        settings.cloneBasePath,
        repository,
      );
      const localState = await getLocalRepositoryState(localPath);

      if (repository.provider === "github") {
        if (!options.includeRemoteMetrics) {
          return {
            ...repository,
            localPath,
            isCloned: localState.isCloned,
            localBranch: localState.localBranch,
            openIssues: repository.openIssues ?? null,
            openPullRequests: repository.openPullRequests ?? null,
            unreadNotifications: repository.unreadNotifications ?? null,
          };
        }

        const connection = settings.githubConnections.find(
          (entry) => entry.id === repository.sourceId,
        );
        const token = connection ? resolveGitHubToken(connection) : "";
        const apiBaseUrl =
          repository.githubApiBaseUrl ||
          connection?.apiBaseUrl ||
          "https://api.github.com";
        const githubCounts = await getGitHubIssueAndPrCounts(
          repository.fullName,
          apiBaseUrl,
          token,
        );
        const notificationCounts = githubNotificationCountsBySource.get(
          repository.sourceId,
        );
        return {
          ...repository,
          localPath,
          isCloned: localState.isCloned,
          localBranch: localState.localBranch,
          openIssues: githubCounts.openIssues ?? repository.openIssues ?? null,
          openPullRequests:
            githubCounts.openPullRequests ??
            repository.openPullRequests ??
            null,
          unreadNotifications: notificationCounts
            ? (notificationCounts.get(repository.fullName) ?? 0)
            : (repository.unreadNotifications ?? null),
        };
      }

      if (!options.includeRemoteMetrics) {
        return {
          ...repository,
          localPath,
          isCloned: localState.isCloned,
          localBranch: localState.localBranch,
          openIssues: repository.openIssues ?? null,
          openPullRequests: repository.openPullRequests ?? null,
          unreadNotifications: repository.unreadNotifications ?? null,
        };
      }

      const azurePrCount = await getAzurePrCount(repository, settings);
      return {
        ...repository,
        localPath,
        isCloned: localState.isCloned,
        localBranch: localState.localBranch,
        openIssues: repository.openIssues ?? null,
        openPullRequests: azurePrCount ?? repository.openPullRequests ?? null,
        unreadNotifications: repository.unreadNotifications ?? null,
      };
    },
  );
}
