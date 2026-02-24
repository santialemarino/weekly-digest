/**
 * format/plain-text.ts — Strips markdown syntax → clean plain text.
 *
 * Good for simple email bodies and universal text-only consumers.
 */

export function toPlainText(markdown: string): string {
    return (
        markdown
            // Headers → UPPERCASE text
            .replace(/^#{1,6}\s+(.+)$/gm, (_, title: string) => title.toUpperCase())
            // Bold / italic → unwrapped text
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/\*(.+?)\*/g, "$1")
            .replace(/_(.+?)_/g, "$1")
            // Horizontal rules → unicode dashes
            .replace(/^---+$/gm, "────────────────────────────")
            // Bullet point syntax is preserved — it renders as-is in plain text
            // Emojis are preserved — they render correctly in Slack, email, and most terminals
            // Collapse multiple blank lines
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    );
}
