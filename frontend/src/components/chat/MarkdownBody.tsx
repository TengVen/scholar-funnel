/**
 * Markdown 渲染组件 —— 对话回复正文
 *
 * 用 react-markdown + remark-gfm 解析，components 映射注入深色纸感主题样式。
 * 纯展示组件：只负责"把 markdown 变成好看的内容"，不承担任何业务逻辑。
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-medium text-ink mt-4 mb-2 first:mt-0 leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-medium text-ink mt-3.5 mb-1.5 first:mt-0 leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-medium text-ink mt-3 mb-1 first:mt-0 leading-snug">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-base text-ink-secondary leading-relaxed my-1.5 first:mt-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="text-base text-ink-secondary leading-relaxed my-1.5 pl-4 list-disc space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="text-base text-ink-secondary leading-relaxed my-1.5 pl-4 list-decimal space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5 marker:text-gold/70">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-gold-light underline decoration-gold/40 underline-offset-2 hover:decoration-gold"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className || "");
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    // 行内代码
    return (
      <code className="px-1.5 py-0.5 rounded bg-paper-warm border border-line text-sm font-mono text-gold-light">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded-lg bg-paper-warm border border-line overflow-x-auto text-sm font-mono leading-relaxed text-ink-secondary">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3 border-l-2 border-gold/40 text-ink-muted italic">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-paper-warm px-2.5 py-1.5 text-left font-medium text-ink">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-line px-2.5 py-1.5 text-ink-secondary align-top">{children}</td>
  ),
  hr: () => <hr className="my-3 border-line" />,
};

export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="md-body min-w-0">
      <ReactMarkdown components={MD_COMPONENTS} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
