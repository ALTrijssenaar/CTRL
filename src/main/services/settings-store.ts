import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AppSettings,
  AzureOrganizationConnection,
  GitHubConnection,
} from "../types/repository";

const defaults: AppSettings = {
  githubConnections: [
    {
      id: "github-com",
      apiBaseUrl: "https://api.github.com",
      token: "",
      tokenEnvVar: "GITHUB_TOKEN",
    },
  ],
  azureOrganizations: [
    {
      id: "azure-default",
      organizationUrl: "",
      pat: "",
      patEnvVar: "AZURE_DEVOPS_PAT",
    },
  ],
  cloneBasePath: path.join(os.homedir(), "repos"),
};

const settingsFilePath = path.join(
  app.getPath("userData"),
  "ctrl-settings.json",
);
const projectConfigFilePath =
  process.env.CTRL_CONFIG_PATH || path.join(process.cwd(), "ctrl.config.json");

export function getProjectConfigFilePath(): string {
  return projectConfigFilePath;
}

interface LegacySettings {
  githubToken?: string;
  azureOrganizationUrl?: string;
  azurePat?: string;
}

type RawSettings = Partial<AppSettings> & LegacySettings;

function readSettingsFile(): AppSettings {
  try {
    if (!fs.existsSync(settingsFilePath)) {
      return defaults;
    }

    const raw = fs.readFileSync(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as RawSettings;

    return normalizeRawSettings(parsed);
  } catch {
    return defaults;
  }
}

function readProjectConfigFile(): Partial<AppSettings> {
  try {
    if (!fs.existsSync(projectConfigFilePath)) {
      return {};
    }

    const raw = fs.readFileSync(projectConfigFilePath, "utf8");
    const parsed = JSON.parse(raw) as RawSettings;
    return normalizeRawSettings(parsed);
  } catch {
    return {};
  }
}

function normalizeRawSettings(parsed: RawSettings): AppSettings {
  const migratedGithubConnections =
    parsed.githubConnections && parsed.githubConnections.length > 0
      ? parsed.githubConnections
      : [
          {
            id: "github-com",
            apiBaseUrl: "https://api.github.com",
            token: parsed.githubToken ?? "",
            tokenEnvVar: "GITHUB_TOKEN",
          },
        ];

  const migratedAzureOrganizations =
    parsed.azureOrganizations && parsed.azureOrganizations.length > 0
      ? parsed.azureOrganizations
      : [
          {
            id: "azure-default",
            organizationUrl: parsed.azureOrganizationUrl ?? "",
            pat: parsed.azurePat ?? "",
            patEnvVar: "AZURE_DEVOPS_PAT",
          },
        ];

  return {
    githubConnections: normalizeGitHubConnections(migratedGithubConnections),
    azureOrganizations: normalizeAzureOrganizations(migratedAzureOrganizations),
    cloneBasePath: parsed.cloneBasePath ?? defaults.cloneBasePath,
    ...(Array.isArray(parsed.agenticWorkflowEnabledRepos) &&
    parsed.agenticWorkflowEnabledRepos.length > 0
      ? {
          agenticWorkflowEnabledRepos: parsed.agenticWorkflowEnabledRepos.filter(
            (r): r is string => typeof r === "string" && r.trim().length > 0,
          ),
        }
      : {}),
  };
}

function mergeSettings(
  base: AppSettings,
  override: Partial<AppSettings>,
): AppSettings {
  return {
    githubConnections:
      override.githubConnections && override.githubConnections.length > 0
        ? normalizeGitHubConnections(override.githubConnections)
        : base.githubConnections,
    azureOrganizations:
      override.azureOrganizations && override.azureOrganizations.length > 0
        ? normalizeAzureOrganizations(override.azureOrganizations)
        : base.azureOrganizations,
    cloneBasePath: override.cloneBasePath?.trim() || base.cloneBasePath,
    agenticWorkflowEnabledRepos:
      override.agenticWorkflowEnabledRepos ??
      base.agenticWorkflowEnabledRepos,
  };
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }

  return Array.from(unique.values());
}

function normalizeGitHubConnections(
  connections: GitHubConnection[],
): GitHubConnection[] {
  const normalized = connections.map((connection, index) => ({
    id: (connection.id || `github-${index + 1}`).trim(),
    apiBaseUrl: (
      connection.apiBaseUrl || defaults.githubConnections[0].apiBaseUrl
    )
      .trim()
      .replace(/\/$/, ""),
    token: (connection.token || "").trim(),
    tokenEnvVar: (connection.tokenEnvVar || "").trim(),
    ...(connection.excludeFromLiveRefresh ? { excludeFromLiveRefresh: true } : {}),
    ...(normalizeStringList(connection.excludeOrganizationsFromLoading).length > 0
      ? {
          excludeOrganizationsFromLoading: normalizeStringList(
            connection.excludeOrganizationsFromLoading,
          ),
        }
      : {}),
  }));

  return normalized.length > 0 ? normalized : defaults.githubConnections;
}

function normalizeAzureOrganizations(
  connections: AzureOrganizationConnection[],
): AzureOrganizationConnection[] {
  const normalized = connections.map((connection, index) => ({
    id: (connection.id || `azure-${index + 1}`).trim(),
    organizationUrl: (connection.organizationUrl || "")
      .trim()
      .replace(/\/$/, ""),
    pat: (connection.pat || "").trim(),
    patEnvVar: (connection.patEnvVar || "").trim(),
    ...(connection.excludeFromLiveRefresh ? { excludeFromLiveRefresh: true } : {}),
    ...(normalizeStringList(connection.excludeProjectsFromLoading).length > 0
      ? {
          excludeProjectsFromLoading: normalizeStringList(
            connection.excludeProjectsFromLoading,
          ),
        }
      : {}),
  }));

  return normalized.length > 0 ? normalized : defaults.azureOrganizations;
}

export function toggleAgenticWorkflowForRepo(
  repoFullName: string,
  enabled: boolean,
): void {
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(projectConfigFilePath)) {
      existing = JSON.parse(
        fs.readFileSync(projectConfigFilePath, "utf8"),
      ) as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors.
  }

  const currentEnabled = Array.isArray(existing.agenticWorkflowEnabledRepos)
    ? (existing.agenticWorkflowEnabledRepos as string[])
    : [];

  const updated = enabled
    ? [...new Set([...currentEnabled, repoFullName])]
    : currentEnabled.filter((r) => r !== repoFullName);

  const updatedConfig = { ...existing, agenticWorkflowEnabledRepos: updated };

  fs.mkdirSync(path.dirname(projectConfigFilePath), { recursive: true });
  fs.writeFileSync(
    projectConfigFilePath,
    JSON.stringify(updatedConfig, null, 2),
    "utf8",
  );
}

export function saveProjectConfig(
  partial: Pick<AppSettings, "githubConnections" | "azureOrganizations">,
): void {
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(projectConfigFilePath)) {
      existing = JSON.parse(
        fs.readFileSync(projectConfigFilePath, "utf8"),
      ) as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors — we will overwrite with valid content.
  }

  const updated = {
    ...existing,
    githubConnections: partial.githubConnections,
    azureOrganizations: partial.azureOrganizations,
  };

  fs.mkdirSync(path.dirname(projectConfigFilePath), { recursive: true });
  fs.writeFileSync(
    projectConfigFilePath,
    JSON.stringify(updated, null, 2),
    "utf8",
  );
}

function writeSettingsFile(settings: AppSettings): void {
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
}

export function getSettings(): AppSettings {
  const userSettings = readSettingsFile();
  const projectConfig = readProjectConfigFile();
  return mergeSettings(userSettings, projectConfig);
}

export function saveSettings(nextSettings: AppSettings): AppSettings {
  const normalized: AppSettings = {
    githubConnections: normalizeGitHubConnections(
      nextSettings.githubConnections,
    ),
    azureOrganizations: normalizeAzureOrganizations(
      nextSettings.azureOrganizations,
    ),
    cloneBasePath: nextSettings.cloneBasePath.trim() || defaults.cloneBasePath,
  };

  writeSettingsFile(normalized);
  return normalized;
}

export function resolveGitHubToken(connection: GitHubConnection): string {
  const envName = connection.tokenEnvVar.trim();
  if (envName && process.env[envName]) {
    return (process.env[envName] || "").trim();
  }

  return connection.token.trim();
}

export function resolveAzurePat(
  connection: AzureOrganizationConnection,
): string {
  const envName = connection.patEnvVar.trim();
  if (envName && process.env[envName]) {
    return (process.env[envName] || "").trim();
  }

  return connection.pat.trim();
}

export function getDefaultClonePath(): string {
  const configured = getSettings().cloneBasePath;
  return configured || path.join(app.getPath("home"), "repos");
}
