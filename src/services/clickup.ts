/**
 * clickup.ts — ClickUp API functions: fetch tasks, extract sprint periods.
 */

import { getCurrentSprintLists } from "./sprint-resolver.js";
import {
    CLICKUP_API,
    LOOKBACK_DAYS,
    DONE_STATUSES,
    DESCRIPTION_MAX_LEN,
    SPRINT_PERIOD_RE,
} from "../config/constants.js";
import { clickupTasksResponseSchema } from "../config/schema.js";
import type { TaskInfo } from "../config/types.js";
import logger from "../config/logger.js";

// Helpers

function spaceIdToProject(spaceMap: Record<string, string>, spaceId: string): string | null {
    for (const [project, sid] of Object.entries(spaceMap)) {
        if (sid === spaceId) return project;
    }
    return null;
}

export function extractSprintPeriod(listName: string): string | null {
    const match = listName.match(SPRINT_PERIOD_RE);
    return match ? `${match[1]} - ${match[2]}` : null;
}

export function parseSprintDates(period: string): [Date, Date] | null {
    try {
        const parts = period.split(" - ");
        const year = new Date().getFullYear();

        const [sMonth, sDay] = parts[0].trim().split("/").map(Number);
        const [eMonth, eDay] = parts[1].trim().split("/").map(Number);

        let start = new Date(year, sMonth - 1, sDay);
        const end = new Date(year, eMonth - 1, eDay, 23, 59, 59);

        // If start is after end, the sprint spans a year boundary
        if (start > end) {
            start = new Date(year - 1, sMonth - 1, sDay);
        }

        return [start, end];
    } catch {
        return null;
    }
}

// API

async function getTasksFromList(
    listId: string,
    clickupToken: string,
    days: number | null = LOOKBACK_DAYS
): Promise<TaskInfo[]> {
    const headers: HeadersInit = { Authorization: clickupToken };
    const params = new URLSearchParams({
        include_closed: "true",
        subtasks: "true",
    });
    if (days !== null) {
        const since = Date.now() - days * 24 * 60 * 60 * 1000;
        params.set("date_updated_gt", String(since));
    }

    try {
        const res = await fetch(`${CLICKUP_API}/list/${listId}/task?${params}`, { headers });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const json: unknown = await res.json();
        const parsed = clickupTasksResponseSchema.safeParse(json);
        if (!parsed.success) {
            logger.warn(
                { listId, error: parsed.error.message },
                "Task response validation warning"
            );
        }
        const allTasks = parsed.success
            ? parsed.data.tasks
            : ((json as { tasks?: unknown[] }).tasks ?? []);

        const doneLower = new Set(DONE_STATUSES.map((s) => s.toLowerCase()));
        return (
            allTasks as Array<{
                name?: string;
                status?: { status?: string };
                assignees?: Array<{ username?: string }>;
                description?: string;
                list?: { name?: string };
            }>
        )
            .filter((t) => doneLower.has((t.status?.status ?? "").toLowerCase()))
            .map((t) => ({
                name: t.name ?? "",
                status: t.status?.status ?? "",
                assignees: (t.assignees ?? []).map((a) => a.username ?? ""),
                description: (t.description ?? "").slice(0, DESCRIPTION_MAX_LEN),
                listName: t.list?.name ?? "",
            }));
    } catch (e) {
        logger.error({ listId, err: e }, "Failed to fetch tasks from ClickUp list");
        return [];
    }
}

export interface ClickUpDataParams {
    spaceMap: Record<string, string>;
    sprintOffset: number;
    clickupToken: string;
}

export async function getAllClickUpData(
    params: ClickUpDataParams
): Promise<{ data: Record<string, TaskInfo[]>; sprintPeriod: string | null }> {
    const { spaceMap, sprintOffset, clickupToken } = params;
    const spaceIds = Object.values(spaceMap);

    // For previous sprints, fetch ALL closed tasks (no date filter)
    const days = sprintOffset === 0 ? LOOKBACK_DAYS : null;

    // 1. Resolve sprint lists for all spaces in parallel
    const spaceEntries = spaceIds.map((spaceId) => ({
        spaceId,
        projectName: spaceIdToProject(spaceMap, spaceId),
    }));

    const listsPerSpace = await Promise.all(
        spaceEntries.map(async ({ spaceId, projectName }) => {
            const label = projectName ? `${projectName} (space ${spaceId})` : `space ${spaceId}`;
            logger.info({ space: label }, "Checking ClickUp space");
            const lists = await getCurrentSprintLists(spaceId, sprintOffset, clickupToken);
            return { projectName, lists };
        })
    );

    // 2. Extract sprint period from the first available list name
    let sprintPeriod: string | null = null;
    for (const { lists } of listsPerSpace) {
        for (const lst of lists) {
            sprintPeriod = extractSprintPeriod(lst.name);
            if (sprintPeriod) break;
        }
        if (sprintPeriod) break;
    }

    // 3. Fetch tasks from all lists in parallel
    const taskFetches = listsPerSpace.flatMap(({ projectName, lists }) =>
        lists.map(async (lst) => {
            const tasks = await getTasksFromList(lst.id, clickupToken, days);
            return { key: projectName ?? lst.name, tasks };
        })
    );

    const taskResults = await Promise.all(taskFetches);

    // 4. Merge results by project key
    const allData: Record<string, TaskInfo[]> = {};
    for (const { key, tasks } of taskResults) {
        if (tasks.length > 0) {
            allData[key] = [...(allData[key] ?? []), ...tasks];
        }
    }

    return { data: allData, sprintPeriod };
}
