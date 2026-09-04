import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownPlugins = [remarkGfm];

export interface MarkdownContentProps {
  content: string;
  className?: string;
  trailing?: ReactNode;
}

/** Render model-authored text without enabling raw HTML or executable URLs. */
export default function MarkdownContent({ content, className, trailing }: MarkdownContentProps) {
  const classes = ["markdown-content", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <ReactMarkdown remarkPlugins={markdownPlugins}>{content}</ReactMarkdown>
      {trailing}
    </div>
  );
}
