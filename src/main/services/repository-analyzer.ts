import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import simpleGit from "simple-git";
import {
  AppSettings,
  AnalyzeRepositoryDescriptionRequest,
  AnalyzeRepositoryDescriptionResult,
  RepositorySummary,
} from "../types/repository";
import {
  getAuthenticatedCloneUrl,
  resolveRepositoryLocalPath,
} from "./git-service";

const FALLBACK_DESCRIPTION = "Source code repository";
const MAX_DESCRIPTION_LENGTH = 320;
const FILE_SCAN_LIMIT = 800;

interface ReadmeInsights {
  sentences: string[];
  keyBullets: string[];
  headings: string[];
}

function sanitizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampDescription(value: string): string {
  const trimmed = sanitizeWhitespace(value);
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

function normalizeRepositoryName(repository: RepositorySummary): string {
  return repository.name.replace(/[-_]+/g, " ").trim();
}

function isNonDescriptiveMarkdownLine(line: string): boolean {
  if (!line) {
    return true;
  }

  if (
    line.includes("![](") ||
    line.includes("![") ||
    /<img\b/i.test(line) ||
    /\bhttps?:\/\//i.test(line) ||
    /\b(shield|badge)\b/i.test(line)
  ) {
    return true;
  }

  return false;
}

function normalizeMarkdownText(line: string): string {
  return sanitizeWhitespace(
    line
      .replace(/`/g, "")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[>*_#]/g, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, ""),
  );
}

function splitSentences(input: string): string[] {
  return input
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sanitizeWhitespace(sentence))
    .filter(Boolean);
}

function sentenceScore(sentence: string, sourceLineIndex: number): number {
  let score = 0;
  const lower = sentence.toLowerCase();

  if (sentence.length >= 45 && sentence.length <= 170) {
    score += 2;
  }
  if (sourceLineIndex <= 80) {
    score += 2;
  }
  if (
    /\b(is|are|provides|helps|allows|supports|manages|builds|analyzes)\b/.test(
      lower,
    )
  ) {
    score += 3;
  }
  if (
    /\b(feature|capability|overview|architecture|integration|workflow|repository|dashboard|service)\b/.test(
      lower,
    )
  ) {
    score += 2;
  }
  if (/\b(license|contributing|author|copyright|changelog)\b/.test(lower)) {
    score -= 3;
  }

  return score;
}

function summarizeReadme(readmeContent: string): string | null {
  const lines = readmeContent.split(/\r?\n/);
  const candidates: Array<{ sentence: string; score: number }> = [];
  const keyBullets: string[] = [];
  const headings: string[] = [];
  const seenSentences = new Set<string>();
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i].trim();
    if (!rawLine) {
      continue;
    }

    if (rawLine.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (rawLine.startsWith("#")) {
      const heading = normalizeMarkdownText(rawLine.replace(/^#+\s*/, ""));
      if (
        heading &&
        heading.length >= 4 &&
        !isNonDescriptiveMarkdownLine(heading)
      ) {
        headings.push(heading);
      }
      continue;
    }

    if (isNonDescriptiveMarkdownLine(rawLine)) {
      continue;
    }

    const normalized = normalizeMarkdownText(rawLine);
    if (
      normalized.length < 25 ||
      /\.(png|jpg|jpeg|gif|svg|webp|ico|md|pdf)$/i.test(normalized) ||
      /^[./\\\w-]+$/.test(normalized)
    ) {
      continue;
    }

    if (/^[-*+]\s+/.test(rawLine) || /^\d+\.\s+/.test(rawLine)) {
      if (
        normalized.length >= 20 &&
        normalized.length <= 140 &&
        !/\b(license|contributing|changelog|author)\b/i.test(normalized)
      ) {
        keyBullets.push(normalized);
      }
    }

    for (const sentence of splitSentences(normalized)) {
      if (sentence.length < 25) {
        continue;
      }

      const dedupeKey = sentence.toLowerCase();
      if (seenSentences.has(dedupeKey)) {
        continue;
      }
      seenSentences.add(dedupeKey);

      candidates.push({
        sentence,
        score: sentenceScore(sentence, i),
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const bestSentences = candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.sentence);

  const uniqueBullets = keyBullets
    .filter(
      (value, index, all) =>
        all.findIndex(
          (entry) => entry.toLowerCase() === value.toLowerCase(),
        ) === index,
    )
    .slice(0, 3);
  const uniqueHeadings = headings
    .filter(
      (value, index, all) =>
        all.findIndex(
          (entry) => entry.toLowerCase() === value.toLowerCase(),
        ) === index,
    )
    .slice(0, 3);

  const summaryParts: string[] = [];
  summaryParts.push(bestSentences.slice(0, 2).join(" "));

  if (uniqueBullets.length > 0) {
    summaryParts.push(`Key capabilities include ${uniqueBullets.join("; ")}.`);
  }

  if (uniqueHeadings.length > 0) {
    summaryParts.push(`Main areas covered are ${uniqueHeadings.join(", ")}.`);
  }

  const result = clampDescription(summaryParts.join(" "));

  // Quality gate: discard result if it contains no repo-specific signal.
  const hasConcreteSignal =
    uniqueBullets.length > 0 ||
    uniqueHeadings.length > 0 ||
    bestSentences.some((sentence) =>
      /\b(is|are|provides|helps|allows|supports|manages|builds|analyzes|enables|lets you|gives you)\b/i.test(
        sentence,
      ),
    );

  if (!hasConcreteSignal) {
    return null;
  }

  return result;
}

async function findFirstExistingFile(
  baseDir: string,
  candidates: string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    const candidatePath = path.join(baseDir, candidate);
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      // Continue scanning candidates.
    }
  }

  return null;
}

async function readPackageDescription(baseDir: string): Promise<string | null> {
  const packageJsonPath = await findFirstExistingFile(baseDir, [
    "package.json",
  ]);
  if (!packageJsonPath) {
    return null;
  }

  try {
    const content = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
      description?: unknown;
    };

    if (typeof content.description === "string" && content.description.trim()) {
      return sanitizeWhitespace(content.description);
    }

    return null;
  } catch {
    return null;
  }
}

async function readPyprojectDescription(
  baseDir: string,
): Promise<string | null> {
  const pyprojectPath = await findFirstExistingFile(baseDir, [
    "pyproject.toml",
  ]);
  if (!pyprojectPath) {
    return null;
  }

  try {
    const content = await fs.readFile(pyprojectPath, "utf8");
    const match = content.match(/^description\s*=\s*"([^"]+)"/m);
    if (!match) {
      return null;
    }

    return sanitizeWhitespace(match[1]);
  } catch {
    return null;
  }
}

async function readReadmeSummary(baseDir: string): Promise<string | null> {
  const readmePath = await findFirstExistingFile(baseDir, [
    "README.md",
    "readme.md",
    "README",
  ]);
  if (!readmePath) {
    return null;
  }

  try {
    const content = await fs.readFile(readmePath, "utf8");
    return summarizeReadme(content);
  } catch {
    return null;
  }
}

async function collectRepositoryFacts(baseDir: string): Promise<{
  topDirs: string[];
  extensionCounts: Map<string, number>;
  rootFiles: string[];
}> {
  const extensionCounts = new Map<string, number>();
  const topDirs: string[] = [];
  const rootFiles: string[] = [];
  let scannedFiles = 0;

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (scannedFiles >= FILE_SCAN_LIMIT) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scannedFiles >= FILE_SCAN_LIMIT) {
        return;
      }

      if (entry.name.startsWith(".")) {
        continue;
      }
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0) {
          topDirs.push(entry.name);
        }
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (entry.isFile()) {
        scannedFiles += 1;
        if (depth === 0) {
          rootFiles.push(entry.name);
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) {
          extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
        }
      }
    }
  }

  await walk(baseDir, 0);

  return {
    topDirs: topDirs.sort((a, b) => a.localeCompare(b)).slice(0, 6),
    extensionCounts,
    rootFiles,
  };
}

function mapExtensionToTech(extension: string): string | null {
  const mappings: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".cs": "C#",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".kt": "Kotlin",
  };

  return mappings[extension] ?? null;
}

async function summarizeRepositoryWithoutReadme(
  baseDir: string,
  repository: RepositorySummary,
): Promise<string> {
  const facts = await collectRepositoryFacts(baseDir);
  const sortedExtensions = Array.from(facts.extensionCounts.entries()).sort(
    (left, right) => right[1] - left[1],
  );
  const techStack = sortedExtensions
    .map(([ext]) => mapExtensionToTech(ext))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 3);

  const projectName = normalizeRepositoryName(repository) || "This repository";
  const parts: string[] = [];

  if (techStack.length > 0) {
    parts.push(
      `${projectName} appears to be a ${techStack.join("/")} codebase.`,
    );
  } else {
    parts.push(`${projectName} appears to be a software repository.`);
  }

  if (facts.topDirs.length > 0) {
    parts.push(
      `The repository structure centers around ${facts.topDirs.join(", ")}.`,
    );
  }

  const notableRootFiles = facts.rootFiles
    .filter((fileName) =>
      [
        "package.json",
        "pyproject.toml",
        "requirements.txt",
        "Dockerfile",
        "docker-compose.yml",
        "tsconfig.json",
        "Makefile",
      ].includes(fileName),
    )
    .slice(0, 3);

  if (notableRootFiles.length > 0) {
    parts.push(`Notable root files include ${notableRootFiles.join(", ")}.`);
  }

  if (repository.provider === "github") {
    parts.push(
      "It appears set up for active collaborative development workflows.",
    );
  } else {
    parts.push(
      "It appears set up for managed development and version control collaboration.",
    );
  }

  return clampDescription(parts.join(" "));
}

function buildDescription(
  repository: RepositorySummary,
  readmeSummary: string | null,
  packageDescription: string | null,
  pyprojectDescription: string | null,
): string {
  const sourceText =
    readmeSummary || packageDescription || pyprojectDescription;
  if (sourceText) {
    return clampDescription(sourceText);
  }

  const name = normalizeRepositoryName(repository);
  return clampDescription(
    name
      ? `${name} ${FALLBACK_DESCRIPTION.toLowerCase()}`
      : FALLBACK_DESCRIPTION,
  );
}

async function ensureRepositoryAvailableForAnalysis(
  repository: RepositorySummary,
  settings: AppSettings,
): Promise<{ analysisPath: string; isTemporary: boolean }> {
  const configuredPath = resolveRepositoryLocalPath(
    settings.cloneBasePath,
    repository,
  );

  try {
    await fs.access(path.join(configuredPath, ".git"));
    return {
      analysisPath: configuredPath,
      isTemporary: false,
    };
  } catch {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrl-analyze-"));
    const cloneUrl = getAuthenticatedCloneUrl(repository, settings);
    const git = simpleGit();

    await git.clone(cloneUrl, tempDir, [
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      repository.defaultBranch,
      "--quiet",
    ]);

    return {
      analysisPath: tempDir,
      isTemporary: true,
    };
  }
}

export async function analyzeRepositoryDescription(
  request: AnalyzeRepositoryDescriptionRequest,
  settings: AppSettings,
): Promise<AnalyzeRepositoryDescriptionResult> {
  const { repository } = request;
  const analysisTarget = await ensureRepositoryAvailableForAnalysis(
    repository,
    settings,
  );

  try {
    const [readmeSummary, packageDescription, pyprojectDescription] =
      await Promise.all([
        readReadmeSummary(analysisTarget.analysisPath),
        readPackageDescription(analysisTarget.analysisPath),
        readPyprojectDescription(analysisTarget.analysisPath),
      ]);

    const description = readmeSummary
      ? buildDescription(
          repository,
          readmeSummary,
          packageDescription,
          pyprojectDescription,
        )
      : await summarizeRepositoryWithoutReadme(
          analysisTarget.analysisPath,
          repository,
        );

    return {
      description,
      remoteUpdated: false,
    };
  } finally {
    if (analysisTarget.isTemporary) {
      await fs.rm(analysisTarget.analysisPath, {
        recursive: true,
        force: true,
      });
    }
  }
}
