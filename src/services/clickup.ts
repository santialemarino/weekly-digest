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
    SPRINT_OFFSET,
} from "../config/constants.js";
import { clickupHeaders, SPACE_IDS, SPACE_MAP } from "../config/env.js";
import type { TaskInfo } from "../config/types.js";
import logger from "../config/logger.js";

// HELPERS

function spaceIdToProject(spaceId: string): string | null {
    for (const [project, sid] of Object.entries(SPACE_MAP)) {
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
    days: number | null = LOOKBACK_DAYS
): Promise<TaskInfo[]> {
    const params = new URLSearchParams({
        include_closed: "true",
        subtasks: "true",
    });
    if (days !== null) {
        const since = Date.now() - days * 24 * 60 * 60 * 1000;
        params.set("date_updated_gt", String(since));
    }

    try {
        const res = await fetch(`${CLICKUP_API}/list/${listId}/task?${params}`, {
            headers: clickupHeaders,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allTasks: any[] = data.tasks ?? [];

        const doneLower = new Set(DONE_STATUSES.map((s) => s.toLowerCase()));
        return (
            allTasks
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((t: any) => doneLower.has((t.status?.status ?? "").toLowerCase()))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((t: any) => ({
                    name: t.name ?? "",
                    status: t.status?.status ?? "",
                    assignees: (t.assignees ?? []).map(
                        (a: { username?: string }) => a.username ?? ""
                    ),
                    description: (t.description ?? "").slice(0, DESCRIPTION_MAX_LEN),
                    listName: t.list?.name ?? "",
                }))
        );
    } catch (e) {
        logger.error({ listId, err: e }, "Failed to fetch tasks from ClickUp list");
        return [];
    }
}

export async function getAllClickUpData(
    offset = SPRINT_OFFSET
): Promise<{ data: Record<string, TaskInfo[]>; sprintPeriod: string | null }> {
    // For previous sprints, fetch ALL closed tasks (no date filter)
    const days = offset === 0 ? LOOKBACK_DAYS : null;

    const allData: Record<string, TaskInfo[]> = {};
    let sprintPeriod: string | null = null;

    for (const spaceId of SPACE_IDS) {
        const projectName = spaceIdToProject(spaceId);
        const label = projectName ? `${projectName} (space ${spaceId})` : `space ${spaceId}`;
        logger.info({ space: label }, "Checking ClickUp space");

        const lists = await getCurrentSprintLists(spaceId, offset);
        for (const lst of lists) {
            if (sprintPeriod === null) {
                sprintPeriod = extractSprintPeriod(lst.name);
            }
            const tasks = await getTasksFromList(lst.id, days);
            if (tasks.length > 0) {
                const key = projectName ?? lst.name;
                allData[key] = [...(allData[key] ?? []), ...tasks];
            }
        }
    }

    return { data: allData, sprintPeriod };
}
