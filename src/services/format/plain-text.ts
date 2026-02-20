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
            // Bold / italic → just the text
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/\*(.+?)\*/g, "$1")
            .replace(/_(.+?)_/g, "$1")
            // Horizontal rules → dashes
            .replace(/^---+$/gm, "────────────────────────────")
            // Bullet points → keep as-is (already readable)
            // Emojis → keep them (most terminals/emails render them)
            // Collapse multiple blank lines
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    );
}
