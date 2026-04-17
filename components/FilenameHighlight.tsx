"use client";

import type { ReactNode } from "react";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlights `searchTerm` inside `text` (case-insensitive). Safe for regex metacharacters in the term.
 */
export function FilenameHighlight({
  text,
  searchTerm,
  className = "bg-yellow-500/30 text-white rounded-sm",
}: {
  text: string;
  searchTerm: string;
  /** Tailwind classes for `<mark>` */
  className?: string;
}): ReactNode {
  const term = searchTerm.trim();
  if (!term || !text) {
    return <>{text}</>;
  }

  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const r = new RegExp(`(${escapeRegExp(term)})`, "gi");
  let key = 0;
  while ((m = r.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    nodes.push(
      <mark key={`m-${key++}`} className={className}>
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes.length > 0 ? <>{nodes}</> : <>{text}</>;
}
