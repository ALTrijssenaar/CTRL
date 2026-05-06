import axios from "axios";
import { AppSettings, Provider, RepositorySummary } from "../types/repository";
import { resolveAzurePat, resolveGitHubToken } from "./settings-store";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toBasicAuthHeader(pat: string): string {
  const encoded = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

function normalizeGitHubApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/$/, "");
}

function getAzureRepositoryId(repository: RepositorySummary): string {
  return repository.id.replace(/^azure-/, "");
}

function formatProviderHttpError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const status = error.response?.status;
  const responseData = error.response?.data as
    | { message?: string; error?: { message?: string } }
    | undefined;
  const responseMessage =
    responseData?.message || responseData?.error?.message || error.message;

  if (!status) {
    return responseMessage;
  }

  return `HTTP ${status}: ${responseMessage}`;
}

export async function publishRepositoryDescription(
  repository: RepositorySummary,
  description: string,
  settings: AppSettings,
): Promise<void> {
  if (repository.provider === "github") {
    const connection = settings.githubConnections.find(
      (entry) => entry.id === repository.sourceId,
    );
    if (!connection) {
      throw new Error("GitHub connection not found for repository source.");
    }

    const token = resolveGitHubToken(connection);
    if (!token) {
      throw new Error("Missing GitHub token for repository source.");
    }

    const apiBaseUrl = normalizeGitHubApiBaseUrl(
      repository.githubApiBaseUrl ||
        connection.apiBaseUrl ||
        "https://api.github.com",
    );

    try {
      await axios.patch(
        `${apiBaseUrl}/repos/${repository.fullName}`,
        {
          description,
        },
        {
          headers: githubHeaders(token),
          timeout: 10000,
        },
      );
    } catch (error) {
      throw new Error(formatProviderHttpError(error));
    }

    return;
  }

  const connection = settings.azureOrganizations.find(
    (entry) => entry.id === repository.sourceId,
  );
  if (!connection) {
    throw new Error("Azure DevOps connection not found for repository source.");
  }

  const pat = resolveAzurePat(connection);
  if (!pat) {
    throw new Error("Missing Azure DevOps PAT for repository source.");
  }

  const organizationUrl = (
    repository.azureOrganizationUrl ||
    connection.organizationUrl ||
    ""
  ).replace(/\/$/, "");
  if (!organizationUrl) {
    throw new Error(
      "Missing Azure DevOps organization URL for repository source.",
    );
  }

  const repositoryId = getAzureRepositoryId(repository);
  const defaultBranch = repository.defaultBranch.startsWith("refs/heads/")
    ? repository.defaultBranch
    : `refs/heads/${repository.defaultBranch}`;

  try {
    await axios.patch(
      `${organizationUrl}/_apis/git/repositories/${repositoryId}`,
      {
        name: repository.name,
        defaultBranch,
        description,
      },
      {
        headers: {
          Authorization: toBasicAuthHeader(pat),
        },
        params: {
          "api-version": "7.1",
        },
        timeout: 10000,
      },
    );
  } catch (error) {
    throw new Error(formatProviderHttpError(error));
  }
}

export function providerLabel(provider: Provider): string {
  return provider === "github" ? "GitHub" : "Azure DevOps";
}
