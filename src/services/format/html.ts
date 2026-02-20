/**
 * format/html.ts — Converts markdown → styled HTML.
 *
 * Uses `marked` for parsing and wraps the result in a professional
 * email-friendly HTML template with inline CSS.
 */

import { marked } from "marked";

const STYLE = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px;
    background: #ffffff;
  }
  h1 {
    font-size: 22px;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 18px;
    color: #2d3748;
    margin-top: 28px;
    margin-bottom: 12px;
  }
  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 20px 0;
  }
  ul {
    padding-left: 20px;
  }
  li {
    margin-bottom: 6px;
  }
  li ul {
    margin-top: 4px;
  }
  strong {
    color: #2d3748;
  }
  p {
    margin: 8px 0;
  }
`.trim();

export function toHtml(markdown: string): string {
    const body = marked.parse(markdown, { async: false }) as string;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}
