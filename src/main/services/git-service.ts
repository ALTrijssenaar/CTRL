import fs from "node:fs/promises";
import path from "node:path";
import simpleGit from "simple-git";
import {
  AppSettings,
  CloneRequest,
  CloneResult,
  RepositorySummary,
} from "../types/repository";
import { resolveAzurePat, resolveGitHubToken } from "./settings-store";

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:\"|?*]/g, "-").trim();
}

function buildTargetPath(
  basePath: string,
  repository: RepositorySummary,
): string {
  const connectionFolder = repository.sourceId;
  const fullName = repository.fullName
    .split("/")
    .map(sanitizePathSegment)
    .join(path.sep);
  return path.join(basePath, connectionFolder, fullName);
}

export function resolveRepositoryLocalPath(
  basePath: string,
  repository: RepositorySummary,
): string {
  return buildTargetPath(basePath, repository);
}

function withGitHubToken(cloneUrl: string, token: string): string {
  if (!token) {
    return cloneUrl;
  }

  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

function withAzurePat(cloneUrl: string, pat: string): string {
  if (!pat) {
    return cloneUrl;
  }

  const url = new URL(cloneUrl);
  url.username = "pat";
  url.password = pat;
  return url.toString();
}

export function getAuthenticatedCloneUrl(
  repository: RepositorySummary,
  settings: AppSettings,
): string {
  if (repository.provider === "github") {
    const connection = settings.githubConnections.find(
      (entry) => entry.id === repository.sourceId,
    );
    const token = connection ? resolveGitHubToken(connection) : "";
    return withGitHubToken(repository.cloneUrl, token);
  }

  const connection = settings.azureOrganizations.find(
    (entry) => entry.id === repository.sourceId,
  );
  const pat = connection ? resolveAzurePat(connection) : "";
  return withAzurePat(repository.cloneUrl, pat);
}

export async function cloneRepository(
  request: CloneRequest,
  settings: AppSettings,
): Promise<CloneResult> {
  const baseDirectory =
    request.targetDirectory?.trim() || settings.cloneBasePath;
  const localPath = buildTargetPath(baseDirectory, request.repository);

  try {
    await fs.access(localPath);
    return {
      localPath,
      alreadyExists: true,
    };
  } catch {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
  }

  const cloneUrl = getAuthenticatedCloneUrl(request.repository, settings);
  const git = simpleGit();
  await git.clone(cloneUrl, localPath, ["--progress"]);

  return {
    localPath,
    alreadyExists: false,
  };
}
