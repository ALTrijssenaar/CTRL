import { contextBridge, ipcRenderer } from "electron";
import {
  AnalyzeRepositoryDescriptionResult,
  AppSettings,
  CloneRequest,
  CloneResult,
  RepositoryDebugState,
  RepositorySummary,
} from "./types/repository";

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:save", settings),
  saveProjectConfig: (
    partial: Pick<AppSettings, "githubConnections" | "azureOrganizations">,
  ): Promise<void> => ipcRenderer.invoke("settings:saveProjectConfig", partial),
  listRepositories: (): Promise<RepositorySummary[]> =>
    ipcRenderer.invoke("repos:list"),
  refreshRepositories: (): Promise<RepositorySummary[]> =>
    ipcRenderer.invoke("repos:refresh"),
  getRepositoryDebugState: (): Promise<RepositoryDebugState> =>
    ipcRenderer.invoke("debug:get"),
  cloneRepository: (request: CloneRequest): Promise<CloneResult> =>
    ipcRenderer.invoke("repo:clone", request),
  analyzeRepository: (
    repository: RepositorySummary,
  ): Promise<AnalyzeRepositoryDescriptionResult> =>
    ipcRenderer.invoke("repo:analyze", { repository }),
  onConfigChanged: (listener: () => void): (() => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("config:changed", wrapped);
    return () => ipcRenderer.removeListener("config:changed", wrapped);
  },
  onRepositoriesUpdated: (
    listener: (repositories: RepositorySummary[]) => void,
  ): (() => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      repositories: RepositorySummary[],
    ) => listener(repositories);
    ipcRenderer.on("repos:updated", wrapped);
    return () => ipcRenderer.removeListener("repos:updated", wrapped);
  },
  onDebugUpdated: (
    listener: (debugState: RepositoryDebugState) => void,
  ): (() => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      debugState: RepositoryDebugState,
    ) => listener(debugState);
    ipcRenderer.on("debug:updated", wrapped);
    return () => ipcRenderer.removeListener("debug:updated", wrapped);
  },
};

contextBridge.exposeInMainWorld("ctrlApi", api);

declare global {
  interface Window {
    ctrlApi: typeof api;
  }
}
