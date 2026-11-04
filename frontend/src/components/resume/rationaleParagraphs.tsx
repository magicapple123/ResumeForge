// SPDX-License-Identifier: Apache-2.0
/**
 * 「为什么是这样一份简历（生成说明）」的按段渲染（2026-11 问题 11）。
 *
 * 后端用 `\n` 分段（`resume_rationale.py` 的 `"\n".join(...)`），旧实现把整段塞进
 * 一个 `whiteSpace: "pre-wrap"` 的 Paragraph——段落之间只有一个行高，6 段连成一整块
 * 密文，1022 字读不出层次。
 *
 * **为什么单独成文件**：宿主 `ResumeDetailPreview` 已贴 500 行预算，解析逻辑不能往里堆。
 * 这里只做两件事：按行拆段、识别"标题式段落"。
 *
 * 旧记录（`rationale` 是生成时落库的固定文本）不会被回溯改写，所以这里必须保证
 * 600+ 字的旧清单也能读：段间距与行高由 `resume-panels.css` 的 `.resume-rationale-body`
 * 负责，与文案长度无关。
 */

/**
 * 标题式段落：整行就是一个标题（以「：」结尾且不含「。」）。
 *
 * 只做轻量识别（issue 方案 A 明确"不做复杂解析"）：真正的正文段落里必然有句号，
 * 而「候选资料组成：项目 2 条、技能 5 条」这类含内容的行不以「：」结尾。
 */
export function isHeadingParagraph(paragraph: string): boolean {
  // i18n-ok: 匹配后端生成的说明文本里的中文标点（协议文本，不翻）
  return paragraph.endsWith("：") && !paragraph.includes("。");
}

/** 标题标签的最大字数：超过就不像标签，而是正文里恰好带冒号。 */
const HEADING_LABEL_MAX_CHARS = 8;

/**
 * 「标签：正文」形态——**真实生成文本里绝大多数段落是这种**。
 *
 * 2026-11-03 用真实 rationale 复核发现：后端产出的是「事实约束：模型只能使用…。」，
 * 标题与正文同一行且带句号，于是 `isHeadingParagraph` 对真实文本**永不命中**——
 * 6 份真实简历里 0 行以「：」结尾。单测当时用的是一个只有「事实约束：」的假数据，
 * 所以绿了而线上没效果。
 *
 * 判据：第一个「：」之前的部分是短标签（≤8 字、不含句号），且冒号后有正文。
 * 命中后由调用方把标签加粗、正文保持常规——这样"标题式段落"在真实文本里也成立。
 */
export function splitHeadingLabel(paragraph: string): { label: string; body: string } | null {
  // i18n-ok: 后端生成的说明文本用全角冒号（协议文本，不翻）
  const index = paragraph.indexOf("：");
  if (index < 1 || index > HEADING_LABEL_MAX_CHARS) return null;
  const label = paragraph.slice(0, index);
  // i18n-ok: 同上，中文句号
  if (label.includes("。")) return null;
  const body = paragraph.slice(index + 1).trim();
  if (!body) return null;
  return { label, body };
}

/** 按行拆段并丢掉空行：连续换行会渲染出一个只占间距的空段落。 */
export function splitRationaleParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface Props {
  /** 生成时落库的说明原文（可能含换行，也可能是一整段）。 */
  text: string;
}

export default function RationaleParagraphs({ text }: Props) {
  const paragraphs = splitRationaleParagraphs(text);
  return (
    <div className="resume-rationale-body">
      {paragraphs.map((paragraph, index) => {
        // 段落内容可能重复（旧记录的清单行），所以 key 带上序号。
        const key = `${index}-${paragraph.slice(0, 16)}`;
        // 整行就是标题：整段加粗（旧口径，仍保留）。
        if (isHeadingParagraph(paragraph)) {
          return (
            <p key={key} className="resume-rationale-heading">
              {paragraph}
            </p>
          );
        }
        // 「标签：正文」：**只加粗标签**，正文保持常规字重——真实生成文本走这一支。
        const labeled = splitHeadingLabel(paragraph);
        if (labeled) {
          return (
            <p key={key}>
              <strong>
                {labeled.label}
                {/* i18n-ok: 全角冒号是协议文本的一部分，不翻 */}：
              </strong>
              {labeled.body}
            </p>
          );
        }
        return <p key={key}>{paragraph}</p>;
      })}
    </div>
  );
}
