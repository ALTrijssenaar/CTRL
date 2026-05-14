import axios from "axios";

interface CopilotMetricsModel {
  name: string;
  is_custom_model?: boolean;
  total_pr_summaries_created?: number;
  total_engaged_users?: number;
}

interface CopilotMetricsRepository {
  name: string;
  total_engaged_users?: number;
  models?: CopilotMetricsModel[];
}

interface CopilotMetricsDotcomPRs {
  total_engaged_users?: number;
  repositories?: CopilotMetricsRepository[];
}

interface CopilotMetricsDayEntry {
  date: string;
  total_active_users?: number;
  copilot_dotcom_pull_requests?: CopilotMetricsDotcomPRs;
}

export interface RepoCopilotMetrics {
  active: boolean;
  interactionsLastMonth: number;
  interactionsCurrentMonth: number;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthRange(
  year: number,
  month: number,
): { since: string; until: string } {
  const since = formatDate(new Date(year, month - 1, 1));
  const lastDay = new Date(year, month, 0);
  return { since, until: formatDate(lastDay) };
}

async function fetchCopilotMetricsRange(
  org: string,
  apiBaseUrl: string,
  token: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const repoTotals = new Map<string, number>();

  try {
    const response = await axios.get<CopilotMetricsDayEntry[]>(
      `${apiBaseUrl}/orgs/${encodeURIComponent(org)}/copilot/metrics`,
      {
        headers: githubHeaders(token),
        params: { since, until },
        timeout: 12000,
      },
    );

    for (const day of response.data) {
      for (const repo of day.copilot_dotcom_pull_requests?.repositories ?? []) {
        const interactions = (repo.models ?? []).reduce(
          (sum, m) => sum + (m.total_pr_summaries_created ?? 0),
          0,
        );
        if (interactions > 0) {
          repoTotals.set(
            repo.name,
            (repoTotals.get(repo.name) ?? 0) + interactions,
          );
        }
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status !== 403 && status !== 404 && status !== 422) {
        console.warn(
          `[copilot] metrics fetch failed for org "${org}" (${since}–${until}): ${error.message}`,
        );
      }
    }
  }

  return repoTotals;
}

export async function fetchOrgCopilotMetrics(
  org: string,
  apiBaseUrl: string,
  token: string,
): Promise<Map<string, RepoCopilotMetrics>> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const lastMonthDate = new Date(currentYear, currentMonth - 2, 1);
  const lastRange = getMonthRange(
    lastMonthDate.getFullYear(),
    lastMonthDate.getMonth() + 1,
  );
  const currentRange = {
    since: formatDate(new Date(currentYear, currentMonth - 1, 1)),
    until: formatDate(now),
  };

  const [lastMonthTotals, currentMonthTotals] = await Promise.all([
    fetchCopilotMetricsRange(
      org,
      apiBaseUrl,
      token,
      lastRange.since,
      lastRange.until,
    ),
    fetchCopilotMetricsRange(
      org,
      apiBaseUrl,
      token,
      currentRange.since,
      currentRange.until,
    ),
  ]);

  const result = new Map<string, RepoCopilotMetrics>();

  for (const repoName of new Set([
    ...lastMonthTotals.keys(),
    ...currentMonthTotals.keys(),
  ])) {
    const lastMonthCount = lastMonthTotals.get(repoName) ?? 0;
    const currentMonthCount = currentMonthTotals.get(repoName) ?? 0;
    result.set(repoName, {
      active: lastMonthCount > 0 || currentMonthCount > 0,
      interactionsLastMonth: lastMonthCount,
      interactionsCurrentMonth: currentMonthCount,
    });
  }

  return result;
}
