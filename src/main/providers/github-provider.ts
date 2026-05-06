import axios from "axios";
import { GitHubConnection, RepositorySummary } from "../types/repository";

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  clone_url: string;
  html_url: string;
  default_branch: string;
  visibility?: string;
  private: boolean;
  owner?: {
    login?: string;
    type?: string;
  };
}

function normalizeNamespace(value: string): string {
  return value.trim().toLowerCase();
}

export async function listGitHubRepositories(
  connection: GitHubConnection,
  token: string,
): Promise<RepositorySummary[]> {
  if (!token) {
    console.info(`[github] skip ${connection.id}: missing token`);
    return [];
  }

  console.info(
    `[github] fetch start ${connection.id} api=${connection.apiBaseUrl}`,
  );

  const repositories: RepositorySummary[] = [];
  const excludedOrganizations = new Set(
    (connection.excludeOrganizationsFromLoading ?? []).map(normalizeNamespace),
  );
  let page = 1;

  while (true) {
    const response = await axios.get<GitHubRepository[]>(
      `${connection.apiBaseUrl}/user/repos`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        params: {
          per_page: 100,
          page,
          affiliation: "owner,collaborator,organization_member",
          sort: "updated",
        },
        timeout: 7000,
      },
    );

    if (response.data.length === 0) {
      break;
    }

    repositories.push(
      ...response.data
        .filter((repo) => {
          const owner = repo.owner?.login ?? repo.full_name.split("/")[0] ?? "";
          return !excludedOrganizations.has(normalizeNamespace(owner));
        })
        .map((repo) => ({
          id: `github-${repo.id}`,
          provider: "github" as const,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          cloneUrl: repo.clone_url,
          webUrl: repo.html_url,
          defaultBranch: repo.default_branch,
          visibility: repo.visibility ?? (repo.private ? "private" : "public"),
          sourceId: connection.id,
          sourceLabel: connection.id,
          githubApiBaseUrl: connection.apiBaseUrl,
          githubOwnerLogin: repo.owner?.login,
          githubOwnerType: repo.owner?.type,
        })),
    );

    page += 1;
  }

  console.info(
    `[github] fetch success ${connection.id} count=${repositories.length}`,
  );

  return repositories;
}
