/**
 * 章节定位（纯函数，无 React 依赖）
 *
 * 把 LLM 输出的章节引用（evidence.section / citations.section，如 "3 Method"、"4. Experiments"）
 * 容错匹配到论文分节列表，得到两种跳转锚点：
 * - index：sections 数组索引 → 正文分节视图锚点（paper-sec-{index+1}）
 * - page：PDF 页码（page_start>0 时可用）→ PDF 视图 #page=N 定位
 *
 * 匹配策略（由强到弱）：标题精确 → 编号相同 → 关键词包含。
 */
import type { PaperSection } from "@/types/dto";

export interface SectionTarget {
  index: number;  // sections 数组索引（正文锚点）
  page: number;   // PDF 页码（0 = 无页码锚点）
}

/** 归一化：去编号前缀 + 去标点/空白 + 小写（"3 METHOD:" → "method"） */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\d+(\.\d+)*[.\s]*/, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

/** 提取编号前缀（"3 Method" → "3"，"5.2 Eval" → "5.2"；无则 null） */
function numOf(s: string): string | null {
  return s.match(/^\d+(\.\d+)*/)?.[0] ?? null;
}

export function matchSection(query: string, sections: PaperSection[]): SectionTarget | null {
  const q = query.trim();
  if (!q || sections.length === 0) return null;
  const qNorm = norm(q);
  const qNum = numOf(q);
  const qWords = qNum ? qNorm : qNorm;

  // 1) 标题精确匹配
  for (let i = 0; i < sections.length; i++) {
    if (norm(sections[i].heading) === qNorm) return target(sections, i);
  }
  // 2) 编号相同（"3 Method" → "3 Methodology"；取编号首次出现的位置）
  if (qNum) {
    for (let i = 0; i < sections.length; i++) {
      if (numOf(sections[i].heading) === qNum) return target(sections, i);
    }
  }
  // 3) 关键词包含（双向：query 包含标题词，或标题包含 query 词）
  if (qWords.length >= 2) {
    for (let i = 0; i < sections.length; i++) {
      const h = norm(sections[i].heading);
      if (h.includes(qWords) || qWords.includes(h)) return target(sections, i);
    }
  }
  return null;
}

function target(sections: PaperSection[], i: number): SectionTarget {
  return { index: i, page: sections[i].page_start ?? 0 };
}

/** 正文分节视图的 DOM 锚点 id */
export function sectionAnchor(index: number): string {
  return `paper-sec-${index + 1}`;
}
