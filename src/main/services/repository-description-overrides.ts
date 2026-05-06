import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Provider, RepositorySummary } from "../types/repository";

interface DescriptionOverrideFile {
  version: 1;
  overrides: Record<string, string>;
}

const overrideFilePath = path.join(
  app.getPath("userData"),
  "repository-description-overrides.json",
);

function getOverrideKey(
  provider: Provider,
  sourceId: string,
  fullName: string,
): string {
  return `${provider}:${sourceId}:${fullName.toLowerCase()}`;
}

function readOverridesFile(): DescriptionOverrideFile {
  try {
    if (!fs.existsSync(overrideFilePath)) {
      return { version: 1, overrides: {} };
    }

    const parsed = JSON.parse(
      fs.readFileSync(overrideFilePath, "utf8"),
    ) as Partial<DescriptionOverrideFile>;

    return {
      version: 1,
      overrides: parsed.overrides ?? {},
    };
  } catch {
    return { version: 1, overrides: {} };
  }
}

function writeOverridesFile(content: DescriptionOverrideFile): void {
  fs.mkdirSync(path.dirname(overrideFilePath), { recursive: true });
  fs.writeFileSync(overrideFilePath, JSON.stringify(content, null, 2), "utf8");
}

export function getRepositoryDescriptionOverride(
  repository: Pick<RepositorySummary, "provider" | "sourceId" | "fullName">,
): string | null {
  const overrides = readOverridesFile().overrides;
  const key = getOverrideKey(
    repository.provider,
    repository.sourceId,
    repository.fullName,
  );

  return overrides[key] ?? null;
}

export function setRepositoryDescriptionOverride(
  repository: Pick<RepositorySummary, "provider" | "sourceId" | "fullName">,
  description: string,
): void {
  const fileContent = readOverridesFile();
  const key = getOverrideKey(
    repository.provider,
    repository.sourceId,
    repository.fullName,
  );

  fileContent.overrides[key] = description;
  writeOverridesFile(fileContent);
}

export function applyRepositoryDescriptionOverrides(
  repositories: RepositorySummary[],
): RepositorySummary[] {
  const overrides = readOverridesFile().overrides;

  return repositories.map((repository) => {
    const key = getOverrideKey(
      repository.provider,
      repository.sourceId,
      repository.fullName,
    );
    const overrideDescription = overrides[key];

    if (!overrideDescription) {
      return repository;
    }

    return {
      ...repository,
      description: overrideDescription,
    };
  });
}
