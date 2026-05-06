import axios from "axios";
import {
  AzureOrganizationConnection,
  RepositorySummary,
} from "../types/repository";

interface AzureRepoResponse {
  value: AzureRepository[];
}

interface AzureRepository {
  id: string;
  name: string;
  description?: string;
  remoteUrl: string;
  webUrl: string;
  defaultBranch: string;
  project?: {
    name: string;
  };
}

function normalizeNamespace(value: string): string {
  return value.trim().toLowerCase();
}

function toBasicAuthHeader(pat: string): string {
  const encoded = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export async function listAzureRepositories(
  connection: AzureOrganizationConnection,
  pat: string,
): Promise<RepositorySummary[]> {
  if (!connection.organizationUrl || !pat) {
    console.info(
      `[azure] skip ${connection.id}: ${!connection.organizationUrl ? "missing organizationUrl" : "missing PAT"}`,
    );
    return [];
  }

  const normalizedOrgUrl = connection.organizationUrl.replace(/\/$/, "");
  const endpoint = `${normalizedOrgUrl}/_apis/git/repositories`;

  console.info(
    `[azure] fetch start ${connection.id} org=${normalizedOrgUrl}`,
  );

  const response = await axios.get<AzureRepoResponse>(endpoint, {
    headers: {
      Authorization: toBasicAuthHeader(pat),
    },
    params: {
      "api-version": "7.1-preview.1",
    },
    timeout: 15000,
  });

  console.info(
    `[azure] fetch success ${connection.id} count=${response.data.value.length}`,
  );

  const excludedProjects = new Set(
    (connection.excludeProjectsFromLoading ?? []).map(normalizeNamespace),
  );

  return response.data.value
    .filter((repo) => {
      const projectName = repo.project?.name ?? "";
      if (!projectName) {
        return true;
      }
      return !excludedProjects.has(normalizeNamespace(projectName));
    })
    .map((repo) => ({
      id: `azure-${repo.id}`,
      provider: "azure-devops" as const,
      name: repo.name,
      fullName: repo.project ? `${repo.project.name}/${repo.name}` : repo.name,
      description: repo.description ?? null,
      cloneUrl: repo.remoteUrl,
      webUrl: repo.webUrl,
      defaultBranch: repo.defaultBranch?.replace("refs/heads/", "") || "main",
      visibility: "private",
      project: repo.project?.name,
      sourceId: connection.id,
      sourceLabel: connection.id,
      azureOrganizationUrl: connection.organizationUrl,
    }));
}
