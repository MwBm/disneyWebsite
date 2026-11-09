import type { ReactNode } from "react";

type ListMatch = {
  ordered: boolean;
  content: string;
};

const LIST_ITEM = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/;
const ORDERED_LIST_ITEM = /^\d+[.)]\s+(.+)$/;
const INLINE_TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/g;

function listMatch(line: string): ListMatch | null {
  const content = line.match(LIST_ITEM)?.[1];
  if (!content) return null;
  return { ordered: ORDERED_LIST_ITEM.test(line), content };
}

function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function formatInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const token = match[0];
    const key = `${match.index}-${token.length}`;
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(<strong key={key} className="font-semibold text-white">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-space-700 px-1.5 py-0.5 font-mono text-[0.82em] text-sky-100">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeLink(link[2]) : null;
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer" className="font-medium text-sky-200 underline decoration-sky-300/50 underline-offset-2 hover:text-white">
            {link![1]}
          </a>
        ) : link?.[1] ?? token
      );
    } else {
      nodes.push(<em key={key} className="text-warm-700">{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Small, safe Markdown renderer for streamed assistant messages. It supports
 * the formats the chat prompt requests without ever rendering model-provided
 * HTML.
 */
export default function ChatMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(
        <h3 key={`heading-${index}`} className="pt-1 text-sm font-semibold tracking-tight text-white">
          {formatInline(heading[2])}
        </h3>
      );
      index += 1;
      continue;
    }

    if (/^([-*_])\1\1+$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} className="border-space-700" />);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={`quote-${index}`} className="border-l-2 border-sky-300/60 pl-3 text-warm-700">
          {formatInline(line.replace(/^>\s?/, ""))}
        </blockquote>
      );
      index += 1;
      continue;
    }

    const firstItem = listMatch(line);
    if (firstItem) {
      const items: string[] = [];
      const ordered = firstItem.ordered;
      while (index < lines.length) {
        const item = listMatch(lines[index].trim());
        if (!item || item.ordered !== ordered) break;
        items.push(item.content);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={`list-${index - items.length}`} className={`space-y-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-sky-300`}>
          {items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{formatInline(item)}</li>)}
        </List>
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || next.startsWith(">") || listMatch(next) || /^([-*_])\1\1+$/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`} className="text-warm-900">{formatInline(paragraph.join(" "))}</p>);
  }

  return <div className="space-y-3 text-[0.925rem] leading-7">{blocks}</div>;
}
