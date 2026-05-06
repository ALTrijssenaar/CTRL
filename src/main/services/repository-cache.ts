import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  Provider,
  RepositoryDataSource,
  RepositorySummary,
} from "../types/repository";

interface SourceCacheEntry {
  provider: Provider;
  sourceId: string;
  sourceLabel: string;
  updatedAt: number;
  repositories: RepositorySummary[];
}

interface RepositoryCacheFile {
  version: 1;
  entries: Record<string, SourceCacheEntry>;
}

const cacheFilePath = path.join(
  app.getPath("userData"),
  "repository-cache.json",
);

function createEmptyCache(): RepositoryCacheFile {
  return {
    version: 1,
    entries: {},
  };
}

function readCacheFile(): RepositoryCacheFile {
  try {
    if (!fs.existsSync(cacheFilePath)) {
      return createEmptyCache();
    }

    const raw = fs.readFileSync(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RepositoryCacheFile>;

    return {
      version: 1,
      entries: parsed.entries ?? {},
    };
  } catch {
    return createEmptyCache();
  }
}

function writeCacheFile(nextCache: RepositoryCacheFile): void {
  fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
  fs.writeFileSync(cacheFilePath, JSON.stringify(nextCache, null, 2), "utf8");
}

export function getRepositoryCacheFilePath(): string {
  return cacheFilePath;
}

export function getSourceCacheKey(
  provider: Provider,
  sourceId: string,
): string {
  return `${provider}:${sourceId}`;
}

export function loadCachedSource(
  provider: Provider,
  sourceId: string,
): SourceCacheEntry | null {
  const cache = readCacheFile();
  const key = getSourceCacheKey(provider, sourceId);
  return cache.entries[key] ?? null;
}

export function saveCachedSource(
  provider: Provider,
  sourceId: string,
  sourceLabel: string,
  repositories: RepositorySummary[],
): void {
  const cache = readCacheFile();
  const key = getSourceCacheKey(provider, sourceId);

  cache.entries[key] = {
    provider,
    sourceId,
    sourceLabel,
    updatedAt: Date.now(),
    repositories,
  };

  writeCacheFile(cache);
}

export function getCachedRepositoriesForSources(
  sources: Array<{ provider: Provider; sourceId: string }>,
): RepositorySummary[] {
  const cache = readCacheFile();

  return sources
    .flatMap((source) => {
      const key = getSourceCacheKey(source.provider, source.sourceId);
      const entry = cache.entries[key];
      if (!entry) {
        return [];
      }

      return attachCacheMetadata(entry.repositories, entry.updatedAt, "cache");
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export function attachCacheMetadata(
  repositories: RepositorySummary[],
  updatedAt: number,
  dataSource: RepositoryDataSource,
): RepositorySummary[] {
  const cacheAgeSeconds = Math.max(
    0,
    Math.round((Date.now() - updatedAt) / 1000),
  );

  return repositories.map((repository) => ({
    ...repository,
    cacheUpdatedAt: updatedAt,
    cacheAgeSeconds,
    dataSource,
  }));
}

export function updateCachedSourcesWithEnrichedRepositories(
  repositories: RepositorySummary[],
): void {
  const cache = readCacheFile();
  const bySource = new Map<
    string,
    { provider: Provider; sourceId: string; repos: RepositorySummary[] }
  >();

  for (const repo of repositories) {
    const key = getSourceCacheKey(repo.provider, repo.sourceId);
    if (!bySource.has(key)) {
      bySource.set(key, {
        provider: repo.provider,
        sourceId: repo.sourceId,
        repos: [],
      });
    }
    bySource.get(key)!.repos.push(repo);
  }

  for (const { provider, sourceId, repos } of bySource.values()) {
    const key = getSourceCacheKey(provider, sourceId);
    const existing = cache.entries[key];
    if (existing) {
      cache.entries[key] = {
        ...existing,
        updatedAt: Date.now(),
        repositories: repos,
      };
    }
  }

  writeCacheFile(cache);
}
