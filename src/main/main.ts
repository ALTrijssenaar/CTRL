import "dotenv/config";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { listGitHubRepositories } from "./providers/github-provider";
import { listAzureRepositories } from "./providers/azure-provider";
import {
  attachCacheMetadata,
  getCachedRepositoriesForSources,
  getRepositoryCacheFilePath,
  loadCachedSource,
  saveCachedSource,
  updateCachedSourcesWithEnrichedRepositories,
} from "./services/repository-cache";
import { cloneRepository } from "./services/git-service";
import { analyzeRepositoryDescription } from "./services/repository-analyzer";
import {
  applyRepositoryDescriptionOverrides,
  setRepositoryDescriptionOverride,
} from "./services/repository-description-overrides";
import {
  providerLabel,
  publishRepositoryDescription,
} from "./services/repository-description-publisher";
import { enrichRepositoriesWithInsights } from "./services/repository-insights";
import {
  getProjectConfigFilePath,
  getSettings,
  resolveAzurePat,
  resolveGitHubToken,
  saveSettings,
  saveProjectConfig,
  toggleAgenticWorkflowForRepo,
} from "./services/settings-store";
import {
  AppSettings,
  CloneRequest,
  Provider,
  RepositoryDebugState,
  RepositoryFetchStatus,
  RepositorySummary,
} from "./types/repository";

let mainWindow: BrowserWindow | null = null;
let configFileWatcher: fs.FSWatcher | null = null;
let configChangeTimer: NodeJS.Timeout | null = null;
let backgroundRefreshPromise: Promise<void> | null = null;
let lastLiveRefreshAt: number | null = null;
const sourceDebugState = new Map<
  string,
  {
    lastFetchStatus: RepositoryFetchStatus;
    lastFetchAt: number | null;
    lastError: string | null;
    repositoryCount: number;
  }
>();
const windowStateFilePath = path.join(
  app.getPath("userData"),
  "window-state.json",
);

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

app.disableHardwareAcceleration();

function readWindowState(): WindowState {
  const defaults: WindowState = {
    width: 1280,
    height: 860,
  };

  try {
    if (!fs.existsSync(windowStateFilePath)) {
      return defaults;
    }

    const raw = fs.readFileSync(windowStateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WindowState>;

    return {
      width: Number.isFinite(parsed.width)
        ? Math.max(900, parsed.width as number)
        : defaults.width,
      height: Number.isFinite(parsed.height)
        ? Math.max(650, parsed.height as number)
        : defaults.height,
      x: Number.isFinite(parsed.x) ? (parsed.x as number) : undefined,
      y: Number.isFinite(parsed.y) ? (parsed.y as number) : undefined,
      isMaximized: Boolean(parsed.isMaximized),
    };
  } catch {
    return defaults;
  }
}

function writeWindowState(window: BrowserWindow): void {
  try {
    const bounds = window.getBounds();
    const nextState: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: window.isMaximized(),
    };

    fs.mkdirSync(path.dirname(windowStateFilePath), { recursive: true });
    fs.writeFileSync(
      windowStateFilePath,
      JSON.stringify(nextState, null, 2),
      "utf8",
    );
  } catch {
    // Ignore state persistence errors to avoid impacting app startup/runtime.
  }
}

function getSourceDebugKey(provider: Provider, sourceId: string): string {
  return `${provider}:${sourceId}`;
}

function updateSourceDebug(
  provider: Provider,
  sourceId: string,
  status: RepositoryFetchStatus,
  repositoryCount: number,
  lastError: string | null,
): void {
  sourceDebugState.set(getSourceDebugKey(provider, sourceId), {
    lastFetchStatus: status,
    lastFetchAt: Date.now(),
    lastError,
    repositoryCount,
  });
}

async function safelyLoadRepositories(
  provider: "github" | "azure-devops",
  sourceId: string,
  label: string,
  settings: AppSettings,
  loader: () => Promise<RepositorySummary[]>,
): Promise<RepositorySummary[]> {
  try {
    updateSourceDebug(provider, sourceId, "refreshing", 0, null);
    notifyDebugUpdated(settings);
    console.info(`[repos] live fetch start ${provider}:${label}`);
    const repositories = await loader();
    const updatedAt = Date.now();
    saveCachedSource(provider, sourceId, label, repositories);
    updateSourceDebug(provider, sourceId, "success", repositories.length, null);
    notifyDebugUpdated(settings);
    console.info(
      `[repos] live fetch success ${provider}:${label} count=${repositories.length} cache=${getRepositoryCacheFilePath()}`,
    );
    return attachCacheMetadata(repositories, updatedAt, "live");
  } catch (error) {
    const cached = loadCachedSource(provider, sourceId);
    console.error(`[repos] live fetch failed ${provider}:${label}`, error);
    if (cached) {
      const ageSeconds = Math.round((Date.now() - cached.updatedAt) / 1000);
      updateSourceDebug(
        provider,
        sourceId,
        "fallback",
        cached.repositories.length,
        error instanceof Error ? error.message : "Unknown error",
      );
      notifyDebugUpdated(settings);
      console.info(
        `[cache] fallback hit ${provider}:${label} count=${cached.repositories.length} age=${ageSeconds}s`,
      );
      return attachCacheMetadata(
        cached.repositories,
        cached.updatedAt,
        "cache",
      );
    }

    updateSourceDebug(
      provider,
      sourceId,
      "error",
      0,
      error instanceof Error ? error.message : "Unknown error",
    );
    notifyDebugUpdated(settings);
    console.info(`[cache] fallback miss ${provider}:${label}`);
    return [];
  }
}

function getConfiguredSources(settings: AppSettings): Array<{
  provider: "github" | "azure-devops";
  sourceId: string;
  sourceLabel: string;
  excludedFromLoading: boolean;
}> {
  return [
    ...settings.githubConnections.map((connection) => ({
      provider: "github" as const,
      sourceId: connection.id,
      sourceLabel: connection.id,
      excludedFromLoading: connection.excludeFromLiveRefresh ?? false,
    })),
    ...settings.azureOrganizations.map((connection) => ({
      provider: "azure-devops" as const,
      sourceId: connection.id,
      sourceLabel: connection.id,
      excludedFromLoading: connection.excludeFromLiveRefresh ?? false,
    })),
  ];
}

function normalizeNamespace(value: string): string {
  return value.trim().toLowerCase();
}

function getRepositoryNamespace(repository: RepositorySummary): string | null {
  if (repository.provider === "github") {
    const separator = repository.fullName.indexOf("/");
    if (separator <= 0) {
      return null;
    }
    return repository.fullName.slice(0, separator);
  }

  if (repository.project?.trim()) {
    return repository.project.trim();
  }

  const separator = repository.fullName.indexOf("/");
  if (separator <= 0) {
    return null;
  }

  return repository.fullName.slice(0, separator);
}

function isRepositoryExcludedByNamespace(
  repository: RepositorySummary,
  settings: AppSettings,
): boolean {
  const namespace = getRepositoryNamespace(repository);
  if (!namespace) {
    return false;
  }

  const namespaceKey = normalizeNamespace(namespace);

  if (repository.provider === "github") {
    const connection = settings.githubConnections.find(
      (entry) => entry.id === repository.sourceId,
    );
    const excluded = connection?.excludeOrganizationsFromLoading ?? [];
    return excluded.some((entry) => normalizeNamespace(entry) === namespaceKey);
  }

  const connection = settings.azureOrganizations.find(
    (entry) => entry.id === repository.sourceId,
  );
  const excluded = connection?.excludeProjectsFromLoading ?? [];
  return excluded.some((entry) => normalizeNamespace(entry) === namespaceKey);
}

function excludeRepositoriesByNamespace(
  repositories: RepositorySummary[],
  settings: AppSettings,
): RepositorySummary[] {
  return repositories.filter(
    (repository) => !isRepositoryExcludedByNamespace(repository, settings),
  );
}

function buildRepositoryDebugState(
  settings: AppSettings,
): RepositoryDebugState {
  return {
    cacheFilePath: getRepositoryCacheFilePath(),
    lastLiveRefreshAt,
    sources: getConfiguredSources(settings).map((source) => {
      const cached = loadCachedSource(source.provider, source.sourceId);
      const runtime = sourceDebugState.get(
        getSourceDebugKey(source.provider, source.sourceId),
      );

      return {
        provider: source.provider,
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        ...(source.excludedFromLoading
          ? {
              repositoryCount: 0,
              cacheUpdatedAt: null,
              cacheAgeSeconds: null,
              lastFetchStatus: "skipped" as const,
              lastFetchAt: runtime?.lastFetchAt ?? null,
              lastError: "Excluded from loading",
            }
          : {
              repositoryCount:
                runtime?.repositoryCount ?? cached?.repositories.length ?? 0,
              cacheUpdatedAt: cached?.updatedAt ?? null,
              cacheAgeSeconds: cached
                ? Math.max(
                    0,
                    Math.round((Date.now() - cached.updatedAt) / 1000),
                  )
                : null,
              lastFetchStatus:
                runtime?.lastFetchStatus ?? (cached ? "cache-hit" : "idle"),
              lastFetchAt: runtime?.lastFetchAt ?? null,
              lastError: runtime?.lastError ?? null,
            }),
      };
    }),
  };
}

function notifyDebugUpdated(settings: AppSettings): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(
    "debug:updated",
    buildRepositoryDebugState(settings),
  );
}

async function loadRepositoriesLive(
  settings: AppSettings,
): Promise<RepositorySummary[]> {
  const githubLists = await Promise.all(
    settings.githubConnections.map(async (connection) => {
      if (connection.excludeFromLiveRefresh) {
        updateSourceDebug(
          "github",
          connection.id,
          "skipped",
          0,
          "Excluded from loading",
        );
        notifyDebugUpdated(settings);
        return [];
      }
      const token = resolveGitHubToken(connection);
      if (!token) {
        updateSourceDebug(
          "github",
          connection.id,
          "skipped",
          0,
          "Missing token",
        );
        notifyDebugUpdated(settings);
        return [];
      }
      return safelyLoadRepositories(
        "github",
        connection.id,
        connection.id,
        settings,
        () => listGitHubRepositories(connection, token),
      );
    }),
  );

  const azureLists = await Promise.all(
    settings.azureOrganizations.map(async (connection) => {
      if (connection.excludeFromLiveRefresh) {
        updateSourceDebug(
          "azure-devops",
          connection.id,
          "skipped",
          0,
          "Excluded from loading",
        );
        notifyDebugUpdated(settings);
        return [];
      }
      const pat = resolveAzurePat(connection);
      if (!connection.organizationUrl || !pat) {
        updateSourceDebug(
          "azure-devops",
          connection.id,
          "skipped",
          0,
          !connection.organizationUrl
            ? "Missing organizationUrl"
            : "Missing PAT",
        );
        notifyDebugUpdated(settings);
        return [];
      }
      return safelyLoadRepositories(
        "azure-devops",
        connection.id,
        connection.id,
        settings,
        () => listAzureRepositories(connection, pat),
      );
    }),
  );

  const repositories = [...githubLists.flat(), ...azureLists.flat()].sort(
    (a, b) => a.fullName.localeCompare(b.fullName),
  );
  const filteredRepositories = applyRepositoryDescriptionOverrides(
    excludeRepositoriesByNamespace(repositories, settings).sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    ),
  );

  lastLiveRefreshAt = Date.now();
  notifyDebugUpdated(settings);
  console.info(`[repos] live aggregate count=${filteredRepositories.length}`);
  const enrichedRepositories = await enrichRepositoriesWithInsights(
    filteredRepositories,
    settings,
    {
      includeRemoteMetrics: true,
    },
  );

  console.info("[cache] saving enriched repositories with metrics to cache");
  updateCachedSourcesWithEnrichedRepositories(enrichedRepositories);

  return enrichedRepositories;
}

function notifyRepositoriesUpdated(repositories: RepositorySummary[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("repos:updated", repositories);
}

function refreshRepositoriesInBackground(settings: AppSettings): void {
  if (backgroundRefreshPromise) {
    console.info(
      "[cache] background refresh skipped because one is already running",
    );
    return;
  }

  backgroundRefreshPromise = (async () => {
    console.info("[cache] background refresh start");
    const repositories = await loadRepositoriesLive(settings);
    notifyRepositoriesUpdated(repositories);
    console.info(
      `[cache] background refresh complete count=${repositories.length}`,
    );
  })().finally(() => {
    backgroundRefreshPromise = null;
  });
}

async function listAllRepositories(
  settings: AppSettings,
): Promise<RepositorySummary[]> {
  const startedAt = Date.now();
  console.info(
    `[repos] list request githubSources=${settings.githubConnections.length} azureSources=${settings.azureOrganizations.length}`,
  );
  const includedSources = getConfiguredSources(settings).filter(
    (source) => !source.excludedFromLoading,
  );

  for (const source of getConfiguredSources(settings).filter(
    (entry) => entry.excludedFromLoading,
  )) {
    updateSourceDebug(
      source.provider,
      source.sourceId,
      "skipped",
      0,
      "Excluded from loading",
    );
  }

  const cachedRepositories = getCachedRepositoriesForSources(includedSources);
  const filteredCachedRepositories = excludeRepositoriesByNamespace(
    cachedRepositories,
    settings,
  );
  const resolvedCachedRepositories = applyRepositoryDescriptionOverrides(
    filteredCachedRepositories,
  );

  if (resolvedCachedRepositories.length > 0) {
    for (const source of includedSources) {
      const cached = loadCachedSource(source.provider, source.sourceId);
      const filteredCount = (cached?.repositories ?? []).filter(
        (repository) => !isRepositoryExcludedByNamespace(repository, settings),
      ).length;
      updateSourceDebug(
        source.provider,
        source.sourceId,
        cached ? "cache-hit" : "cache-miss",
        filteredCount,
        null,
      );
    }
    notifyDebugUpdated(settings);
    console.info(
      `[cache] startup hit count=${resolvedCachedRepositories.length} cache=${getRepositoryCacheFilePath()}`,
    );
    refreshRepositoriesInBackground(settings);
    const result = await enrichRepositoriesWithInsights(
      resolvedCachedRepositories,
      settings,
      {
        includeRemoteMetrics: false,
      },
    );
    console.info(
      `[repos] list response from cache count=${result.length} durationMs=${Date.now() - startedAt}`,
    );
    return result;
  }

  console.info("[cache] startup miss, fetching live repositories");
  for (const source of includedSources) {
    updateSourceDebug(source.provider, source.sourceId, "cache-miss", 0, null);
  }
  notifyDebugUpdated(settings);
  const result = await loadRepositoriesLive(settings);
  console.info(
    `[repos] list response from live count=${result.length} durationMs=${Date.now() - startedAt}`,
  );
  return result;
}

function registerIpcHandlers(): void {
  ipcMain.handle("settings:get", async () => {
    return getSettings();
  });

  ipcMain.handle("settings:save", async (_event, settings: AppSettings) => {
    return saveSettings(settings);
  });

  ipcMain.handle(
    "settings:saveProjectConfig",
    async (
      _event,
      partial: Pick<AppSettings, "githubConnections" | "azureOrganizations">,
    ) => {
      saveProjectConfig(partial);
    },
  );

  ipcMain.handle("repos:list", async () => {
    const settings = getSettings();
    return listAllRepositories(settings);
  });

  ipcMain.handle("debug:get", async () => {
    const settings = getSettings();
    return buildRepositoryDebugState(settings);
  });

  ipcMain.handle("repos:refresh", async () => {
    const settings = getSettings();
    console.info("[repos] manual refresh requested");
    return loadRepositoriesLive(settings);
  });

  ipcMain.handle("repo:clone", async (_event, request: CloneRequest) => {
    const settings = getSettings();
    return cloneRepository(request, settings);
  });

  ipcMain.handle("repo:analyze", async (_event, request) => {
    const settings = getSettings();
    const analysisResult = await analyzeRepositoryDescription(
      request,
      settings,
    );
    setRepositoryDescriptionOverride(
      request.repository,
      analysisResult.description,
    );

    try {
      await publishRepositoryDescription(
        request.repository,
        analysisResult.description,
        settings,
      );

      return {
        ...analysisResult,
        remoteUpdated: true,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.warn(
        `[repos] analyze publish failed ${request.repository.provider}:${request.repository.fullName}: ${details}`,
      );

      return {
        ...analysisResult,
        remoteUpdated: false,
        remoteError: `${providerLabel(request.repository.provider)} update failed: ${details}`,
      };
    }
  });

  ipcMain.handle(
    "repo:toggleAgenticWorkflow",
    async (_event, repoFullName: string, enabled: boolean) => {
      toggleAgenticWorkflowForRepo(repoFullName, enabled);
      const settings = getSettings();
      return loadRepositoriesLive(settings);
    },
  );
}

function notifyConfigChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  console.info("[config] ctrl.config.json changed, notifying renderer");
  mainWindow.webContents.send("config:changed");
}

function startProjectConfigWatcher(): void {
  const configFilePath = getProjectConfigFilePath();
  const configDirectory = path.dirname(configFilePath);
  const configFileName = path.basename(configFilePath);

  try {
    configFileWatcher = fs.watch(configDirectory, (_eventType, filename) => {
      if (!filename || filename.toString() !== configFileName) {
        return;
      }

      if (configChangeTimer) {
        clearTimeout(configChangeTimer);
      }

      configChangeTimer = setTimeout(() => {
        notifyConfigChanged();
      }, 200);
    });
    console.info(`[config] watching ${configFilePath}`);
  } catch {
    configFileWatcher = null;
    console.info(`[config] watcher unavailable for ${configFilePath}`);
  }
}

async function createWindow(): Promise<void> {
  const windowState = readWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  const persistWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    writeWindowState(mainWindow);
  };

  // Persist all relevant size/position changes so FancyZones snapping and resize behavior survive app restarts.
  mainWindow.on("resize", persistWindowState);
  mainWindow.on("move", persistWindowState);
  mainWindow.on("maximize", persistWindowState);
  mainWindow.on("unmaximize", persistWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in default browser instead of in the app
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {
        console.error(`Failed to open external link: ${url}`);
      });
    }
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  startProjectConfigWatcher();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (configFileWatcher) {
    configFileWatcher.close();
    configFileWatcher = null;
  }

  if (configChangeTimer) {
    clearTimeout(configChangeTimer);
    configChangeTimer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
