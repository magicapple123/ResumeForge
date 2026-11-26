// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历编辑页的**左侧选择区**（#5）。
 *
 * 两种形态按格式分，不是按偏好分：
 * - `pdf`：pdf.js 把页画到 canvas 上，再按后端给的 bbox 画点选热区。文字块是**有纸面
 *   位置的**，所以用户能"点住要改的那一行"；热区用百分比定位，页面缩放不用重算。
 * - `docx` / `text`：没有纸面坐标（几何字段恒为 0），画热区只会画出一堆叠在原点的方块。
 *   这里改成段落列表，点一段在右边改。
 *
 * 不可编辑的块**不给点**，并把原因码翻成中文写在块上：`disabled` 的按钮既挡点击，
 * 也让读屏知道"这块是禁用的"。整份不支持（扫描件 / 转曲 / 加密）由外层解释，不在这里。
 */
import { Alert, Typography } from "antd";
import { useEffect, useRef } from "react";
import type { ExternalResumeBlock, ExternalResumeBlocks } from "../../../api/externalResumes";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { blockPercentRect, blocksOfPage, reasonKey } from "./blockGeometry";
import { drawPdfPage, usePdfPages } from "./usePdfPages";

export interface ExternalResumeEditorProps {
  blocks: ExternalResumeBlocks;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  /** 原件直链（带版本号，编辑后换 URL 即重新取字节）。 */
  fileUrl: string;
}

/** 块的读法：PDF 带页码，docx / text 只有段序。 */
function blockLabel(block: ExternalResumeBlock, index: number): string {
  if (block.page > 0) {
    return t("externalEdit.block.label", { page: block.page, index: index + 1 });
  }
  return t("externalEdit.block.labelNoPage", { index: index + 1 });
}

/** 不可编辑的原因（中文句子）；可编辑时调用方不应渲染它。 */
function blockReason(block: ExternalResumeBlock): string {
  return t(reasonKey(block.reason));
}

/** PDF：canvas + 百分比热区。 */
function PdfBlockEditor({ blocks, selectedId, onSelect, fileUrl }: ExternalResumeEditorProps) {
  const pdf = usePdfPages(fileUrl);
  const canvases = useRef(new Map<number, HTMLCanvasElement>());

  // 画布挂上之后再画：pdf.js 需要一个真实的 canvas 元素，而它只在渲染之后才存在。
  useEffect(() => {
    const doc = pdf.document;
    if (pdf.status !== "ready" || doc === null) return;
    let cancelled = false;
    void (async () => {
      for (const box of pdf.pages) {
        const canvas = canvases.current.get(box.page);
        if (!canvas) continue;
        await drawPdfPage(canvas, doc, box);
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf.status, pdf.document, pdf.pages]);

  const page = { width: blocks.page_width, height: blocks.page_height };

  return (
    <div data-testid="external-editor" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Typography.Text type="secondary">{t("externalEdit.hint.pdf")}</Typography.Text>
      {pdf.status === "loading" ? <LoadingBlock tip={t("externalEdit.previewLoading")} /> : null}
      {pdf.status === "error" ? (
        <Alert type="warning" showIcon title={t("externalEdit.previewFailed")} description={pdf.error} />
      ) : null}
      {pdf.status === "ready"
        ? pdf.pages.map((box) => (
            <div
              key={box.page}
              data-testid={`external-page-${box.page}`}
              style={{ position: "relative", width: "100%", maxWidth: box.width }}
            >
              <canvas
                data-testid={`external-page-canvas-${box.page}`}
                ref={(node) => {
                  if (node) canvases.current.set(box.page, node);
                  else canvases.current.delete(box.page);
                }}
                style={{ display: "block", width: "100%", height: "auto" }}
              />
              {blocksOfPage(blocks.blocks, box.page).map((block) => {
                const rect = blockPercentRect(block, page);
                if (rect === null) return null;
                const index = blocks.blocks.indexOf(block);
                const label = blockLabel(block, index);
                const reason = blockReason(block);
                return (
                  <button
                    key={block.block_id}
                    type="button"
                    data-testid={`external-block-${block.block_id}`}
                    aria-label={block.editable ? label : `${label} · ${reason}`}
                    aria-pressed={block.block_id === selectedId}
                    title={block.editable ? block.text : reason}
                    disabled={!block.editable}
                    onClick={() => onSelect(block.block_id)}
                    style={{
                      position: "absolute",
                      left: `${rect.left}%`,
                      top: `${rect.top}%`,
                      width: `${rect.width}%`,
                      height: `${rect.height}%`,
                      padding: 0,
                      border: block.block_id === selectedId ? "2px solid var(--rf-brand)" : "1px dashed rgba(22,119,255,.45)",
                      background:
                        block.block_id === selectedId ? "rgba(22,119,255,.16)" : "rgba(22,119,255,.06)",
                      cursor: block.editable ? "pointer" : "not-allowed",
                      opacity: block.editable ? 1 : 0.5,
                    }}
                  />
                );
              })}
            </div>
          ))
        : null}
      <NotEditableList blocks={blocks.blocks} />
    </div>
  );
}

/** 段落列表：docx / text 没有纸面坐标。 */
function ParagraphBlockList({ blocks, selectedId, onSelect }: ExternalResumeEditorProps) {
  return (
    <div data-testid="external-editor" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Typography.Text type="secondary">
        {blocks.kind === "docx" ? t("externalEdit.hint.docx") : t("externalEdit.hint.text")}
      </Typography.Text>
      {blocks.blocks.length === 0 ? (
        <Alert type="warning" showIcon title={t("externalEdit.blocksEmpty")} />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {blocks.blocks.map((block, index) => {
          const label = blockLabel(block, index);
          return (
            <button
              key={block.block_id}
              type="button"
              data-testid={`external-block-${block.block_id}`}
              aria-label={label}
              aria-pressed={block.block_id === selectedId}
              disabled={!block.editable}
              onClick={() => onSelect(block.block_id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 8,
                border:
                  block.block_id === selectedId
                    ? "1px solid var(--rf-brand)"
                    : "1px solid var(--rf-border)",
                background:
                  block.block_id === selectedId ? "rgba(22,119,255,.08)" : "var(--rf-surface)",
                cursor: block.editable ? "pointer" : "not-allowed",
                opacity: block.editable ? 1 : 0.65,
                font: "inherit",
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {label}
              </Typography.Text>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {block.text || t("externalEdit.block.empty")}
              </div>
              {block.editable ? null : (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {blockReason(block)}
                </Typography.Text>
              )}
            </button>
          );
        })}
      </div>
      <NotEditableList blocks={blocks.blocks} />
    </div>
  );
}

/**
 * 不能改的块逐条说明原因。
 *
 * 只在热区上放 `title` 不够：禁用的按钮在很多浏览器里连 title 都不弹，用户只会觉得
 * "点了没反应"。这里把原因摆出来，等于回答"为什么这一块点不动"。
 */
function NotEditableList({ blocks }: { blocks: readonly ExternalResumeBlock[] }) {
  const blocked = blocks.filter((block) => !block.editable);
  if (blocked.length === 0) return null;
  return (
    <div data-testid="external-not-editable">
      <Typography.Text type="secondary">{t("externalEdit.notEditableList")}</Typography.Text>
      <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
        {blocked.map((block) => (
          <li key={block.block_id}>
            <Typography.Text type="secondary">
              {`${blockLabel(block, blocks.indexOf(block))} · ${blockReason(block)}`}
            </Typography.Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExternalResumeEditor(props: ExternalResumeEditorProps) {
  useLocale();
  if (props.blocks.kind === "pdf") return <PdfBlockEditor {...props} />;
  return <ParagraphBlockList {...props} />;
}

export default ExternalResumeEditor;
