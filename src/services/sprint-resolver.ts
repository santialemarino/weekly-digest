/**
 * sprint-resolver.ts — Finds the current (or previous) sprint folder in a ClickUp space
 * and returns its lists. Used by the weekly-digest pipeline to know which
 * ClickUp lists to pull tasks from.
 *
 * Requires CLICKUP_API_TOKEN in .env.
 * Looks for folders containing "Sprint Folder" or "Development" in the name.
 */

import "dotenv/config";
import logger from "../config/logger.js";
import { clickupFoldersResponseSchema, clickupListsResponseSchema } from "../config/schema.js";

// CONSTANTS

const CLICKUP_API = "https://api.clickup.com/api/v2";

// Folder names must contain one of these keywords to be considered sprint folders
const SPRINT_FOLDER_KEYWORDS = ["Sprint Folder", "Development"];

// Pattern to extract the sprint/week number from a list name
// Matches: "Sprint 1 (…)", "Week 3 (…)", "Sprint-12", etc.
const LIST_NUMBER_PATTERN = /(?:Sprint|Week)\s*[_-]?\s*(\d+)/i;

// CLICKUP SETUP

const headers: HeadersInit = {
    Authorization: process.env.CLICKUP_API_TOKEN ?? "",
};

interface ClickUpList {
    id: string;
    name: string;
}

interface ClickUpFolder {
    id: string;
    name: string;
}

async function fetchAndParse<T>(
    url: string,
    schema: {
        safeParse: (data: unknown) => { success: boolean; data?: T; error?: { message: string } };
    }
): Promise<T> {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`ClickUp API error: ${res.status} ${res.statusText}`);
    }
    const json: unknown = await res.json();
    const result = schema.safeParse(json);
    if (!result.success) {
        logger.warn({ url, error: result.error?.message }, "ClickUp response validation warning");
        return json as T; // fallback to raw data if schema doesn't match perfectly
    }
    return result.data!;
}

export async function getCurrentSprintLists(spaceId: string, offset = 0): Promise<ClickUpList[]> {
    // Fetch all (non-archived) folders in the space
    let folders: ClickUpFolder[];
    try {
        const data = await fetchAndParse(
            `${CLICKUP_API}/space/${spaceId}/folder?archived=false`,
            clickupFoldersResponseSchema
        );
        folders = data.folders ?? [];
    } catch (e) {
        logger.error({ spaceId, err: e }, "Failed to fetch ClickUp folders");
        return [];
    }

    // Filter folders whose name contains any of the keywords
    const sprintFolders = folders.filter((f) =>
        SPRINT_FOLDER_KEYWORDS.some((kw) => f.name.toLowerCase().includes(kw.toLowerCase()))
    );

    if (sprintFolders.length === 0) {
        logger.warn(
            {
                spaceId,
                keywords: SPRINT_FOLDER_KEYWORDS,
                found: folders.map((f) => f.name),
            },
            "No sprint folders found in space"
        );
        return [];
    }

    const allCurrentLists: ClickUpList[] = [];

    for (const folder of sprintFolders) {
        logger.debug({ folder: folder.name, folderId: folder.id }, "Sprint folder found");

        // Fetch lists inside this folder.
        // ClickUp's archived param is a filter (true = only archived, false = only active),
        // so when looking at previous sprints we need both calls to cover all lists.
        let lists: ClickUpList[];
        try {
            const data = await fetchAndParse(
                `${CLICKUP_API}/folder/${folder.id}/list?archived=false`,
                clickupListsResponseSchema
            );
            lists = data.lists ?? [];

            // Also fetch archived lists when looking for previous sprints
            if (offset > 0) {
                const archivedData = await fetchAndParse(
                    `${CLICKUP_API}/folder/${folder.id}/list?archived=true`,
                    clickupListsResponseSchema
                );
                const archived = archivedData.lists ?? [];
                if (archived.length > 0) {
                    logger.debug({ count: archived.length }, "Archived lists found");
                }
                lists.push(...archived);
            }
        } catch (e) {
            logger.error({ folderId: folder.id, err: e }, "Failed to fetch lists from folder");
            continue;
        }

        if (lists.length === 0) {
            logger.debug({ folder: folder.name }, "No lists found in folder");
            continue;
        }

        // Find all numbered lists and sort descending (highest = most recent)
        const numberedLists: [number, ClickUpList][] = [];
        for (const lst of lists) {
            const match = lst.name.match(LIST_NUMBER_PATTERN);
            if (match) {
                numberedLists.push([parseInt(match[1], 10), lst]);
            }
        }

        if (numberedLists.length === 0) {
            logger.warn(
                { folder: folder.name, lists: lists.map((l) => l.name) },
                "No numbered sprint/week lists found"
            );
            continue;
        }

        numberedLists.sort((a, b) => b[0] - a[0]);
        logger.debug(
            { sprints: numberedLists.map(([, l]) => l.name) },
            "Sprint lists found (sorted)"
        );

        if (offset >= numberedLists.length) {
            logger.warn(
                { offset, available: numberedLists.length },
                "Not enough sprints for requested offset"
            );
            continue;
        }

        const [, selectedList] = numberedLists[offset];
        const label = offset === 0 ? "Current" : `Previous (offset=${offset})`;
        logger.info(
            { sprint: selectedList.name, listId: selectedList.id, selection: label },
            "Sprint list selected"
        );
        allCurrentLists.push(selectedList);
    }

    return allCurrentLists;
}
