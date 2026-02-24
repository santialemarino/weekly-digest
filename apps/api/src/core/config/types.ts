export interface TaskInfo {
    name: string;
    status: string;
    assignees: string[];
    description: string;
    listName: string;
}

export interface SlackMessage {
    text?: string;
    subtype?: string;
    bot_id?: string;
    reply_count?: number;
    ts?: string;
}
