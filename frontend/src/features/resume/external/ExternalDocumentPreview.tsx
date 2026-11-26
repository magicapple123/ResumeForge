// SPDX-License-Identifier: Apache-2.0
/**
 * 非 PDF 原件的**只读预览**（R9-7）：DOCX 结构预览、TXT 等宽原文、MD 轻量渲染、`.doc` 引导。
 *
 * ## 为什么 DOCX 不引进新的转换依赖
 *
 * 后端 `_docx_text` 已经把 docx 按段落抽成纯文本，`/blocks` 端点把它按段返回（每段一个
 * 编辑单元）。预览直接复用这份数据，零新依赖、零第二次解析；代价是分栏、文本框、图表
 * 这些版式会退化，所以页脚印一句「结构预览」，不假装它与 Word 里一模一样。
 *
 * ## 为什么 `.doc` 只给引导
 *
 * `.doc` 是二进制复合文档，现有链路读不了（`_docx_text` 只认 zip+xml）。与其显示一块
 * 空白，不如明确告诉用户「另存为 .docx 再上传」——这是唯一能真的走通的路。
 *
 * ## 暗色口径
 *
 * 这里是**我们自己渲染的 HTML**（没有原件的像素），所以直接用主题变量着色，
 * 不需要内部简历那套「反色 + img 抵消」。打印时同理：`@media print` 里换成白底黑字。
 */
import { Alert, Button, Space, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { externalResumeFileUrl, getExternalResumeBlocks } from "../../../api/externalResumes";
import type { ExternalResumeDetail } from "../../../api/externalResumes";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ExternalFileKind } from "../../../utils/fileKind";

export interface ExternalDocumentPreviewProps {
  record: ExternalResumeDetail;
  kind: ExternalFileKind;
}

/**
 * 行内只认 `**加粗**`：再多就不是"轻量"了，交给真正的编辑器。
 *
 * `key` 只用**数组下标**：每次调用都返回一个独立数组，同一父节点里不会并列出现两份，
 * 所以下标已经够用。早先传过"前缀字符串 + 下标"，那是多余的——而且**那个前缀字符串
 * 会被产品文案棘轮当成一处新增文案**（它是喂给函数的字符串字面量，扫描器分不清它
 * 是 key 还是界面字）。少一个参数，就少一处要解释的东西。
 */
function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part.length > 0)
    .map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={`b${index}`}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={`t${index}`}>{part}</span>
      ),
    );
}

/**
 * Markdown 的轻量渲染：标题（`#`～`###`）、无序/有序列表、`**加粗**`。
 *
 * 其余语法（表格、代码块、图片）按纯文本行输出——显示成字比显示成 HTML 更安全，
 * 也不用在这里养一个 Markdown 解析器。
 */
function renderMarkdown(source: string): ReactNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  /** 列表块的 key 片段用**行序号**（数字），不再拼一个 `md-<n>` 字符串见上。 */
  const flushList = (seq: number) => {
    if (list === null) return;
    const items = list.items.map((item, index) => (
      <li key={`l${seq}-${index}`}>{renderInline(item)}</li>
    ));
    nodes.push(list.ordered ? <ol key={`o${seq}`}>{items}</ol> : <ul key={`u${seq}`}>{items}</ul>);
    list = null;
  };
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushList(index);
      const level = heading[1].length;
      const text = heading[2];
      nodes.push(
        level === 1 ? (
          <h1 key={`h${index}`}>{renderInline(text)}</h1>
        ) : level === 2 ? (
          <h2 key={`h${index}`}>{renderInline(text)}</h2>
        ) : (
          <h3 key={`h${index}`}>{renderInline(text)}</h3>
        ),
      );
      return;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ordered || bullet) {
      const isOrdered = ordered !== null;
      if (list === null || list.ordered !== isOrdered) {
        flushList(index);
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((ordered ?? bullet)?.[1] ?? "");
      return;
    }
    flushList(index);
    if (line.trim().length === 0) return;
    nodes.push(<p key={`p${index}`}>{renderInline(line)}</p>);
  });
  flushList(lines.length);
  return nodes;
}

/** 预览页脚：一句"这是什么级别的还原"，不让用户误以为是原件截图。 */
function PreviewFooter({ children }: { children: ReactNode }) {
  return (
    <Typography.Text type="secondary" className="rf-ext-doc-footer">
      {children}
    </Typography.Text>
  );
}

function DownloadAction({ record }: { record: ExternalResumeDetail }) {
  return (
    <Button
      icon={<DownloadOutlined />}
      href={externalResumeFileUrl(record.id)}
      target="_blank"
      rel="noreferrer"
    >
      {t("resumesPage.external.downloadOriginal")}
    </Button>
  );
}

/** DOCX：借 `/blocks` 的段落还原成一页"文档"。 */
function DocxPreview({ record }: { record: ExternalResumeDetail }) {
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getExternalResumeBlocks(record.id)
      .then((next) => {
        if (cancelled) return;
        setParagraphs(next.blocks.map((block) => block.text).filter((text) => text.trim().length > 0));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setParagraphs([]);
        setError(caught instanceof Error ? caught.message : t("externalEdit.preview.failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [record.id]);

  if (error) {
    return <ErrorState description={error} />;
  }
  if (paragraphs === null) {
    return <LoadingBlock tip={t("externalEdit.original.loading")} />;
  }
  return (
    <div className="rf-ext-doc" data-testid="external-docx-preview">
      <div className="rf-ext-doc-paper">
        {paragraphs.length === 0 ? (
          <Typography.Text type="secondary">{t("externalEdit.preview.empty")}</Typography.Text>
        ) : (
          paragraphs.map((text, index) => (
            // 段落序号是稳定 key：同一份 docx 的段落顺序不会变，正文重复也不会撞。
            <p key={`docx-${index}`}>{text}</p>
          ))
        )}
        <PreviewFooter>{t("externalEdit.preview.docxFooter")}</PreviewFooter>
      </div>
    </div>
  );
}

/** TXT：等宽原文，保留换行与空格（`<pre>` 天然如此）。 */
function TextPreview({ record }: { record: ExternalResumeDetail }) {
  if (!record.has_text) {
    return (
      <Alert
        type="warning"
        showIcon
        title={t("resumesPage.external.textEmpty")}
        action={<DownloadAction record={record} />}
      />
    );
  }
  return (
    <div className="rf-ext-doc" data-testid="external-text-preview">
      <div className="rf-ext-doc-paper">
        <pre className="rf-ext-doc-plain">{record.text}</pre>
        <PreviewFooter>{t("externalEdit.preview.textFooter")}</PreviewFooter>
      </div>
    </div>
  );
}

/** MD：轻量渲染。正文取提取到的文本（与「文本」页签同源，不另取一次）。 */
function MarkdownPreview({ record }: { record: ExternalResumeDetail }) {
  if (!record.has_text) {
    return (
      <Alert
        type="warning"
        showIcon
        title={t("resumesPage.external.textEmpty")}
        action={<DownloadAction record={record} />}
      />
    );
  }
  return (
    <div className="rf-ext-doc" data-testid="external-markdown-preview">
      <div className="rf-ext-doc-paper rf-ext-md">
        {renderMarkdown(record.text)}
        <PreviewFooter>{t("externalEdit.preview.markdownFooter")}</PreviewFooter>
      </div>
    </div>
  );
}

export function ExternalDocumentPreview({ record, kind }: ExternalDocumentPreviewProps) {
  useLocale();
  if (kind === "docx") return <DocxPreview record={record} />;
  if (kind === "markdown") return <MarkdownPreview record={record} />;
  if (kind === "text") return <TextPreview record={record} />;
  // `.doc` 与其它不认识的格式：只有"另存为 .docx"这一条路走得通。
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        data-testid="external-doc-fallback"
        type="info"
        showIcon
        title={t("externalEdit.preview.docHint")}
        description={t("resumesPage.external.originalUnsupported")}
      />
      <DownloadAction record={record} />
    </Space>
  );
}

export default ExternalDocumentPreview;
