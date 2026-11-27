// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑页的**左栏：段落清单**（R9-5 改造后的形态）。
 *
 * ## 为什么不在这里再画一遍 PDF
 *
 * 旧流程是"在 PDF 上点一段 → 目光跳到右边小框"，读起来很累：页面上的字本来就小，
 * 点中的块还被半透明色块盖住。现在把职责分开：
 * - **原件页**只负责"看"（pdf.js 画布 + 缩放，见 `ExternalOriginalPreview`）；
 * - **编辑页**只负责"改"——左栏是段落清单（序号 / 摘要 / 页内位置 / 标题·正文·锁定），
 *   右栏是原文 + 新文输入。
 *
 * 三种格式都走同一份清单：PDF 的块有页码，DOCX 的块是段落（`page` 为 0，写「不分页」），
 * TXT / MD 只有一个整篇单元。清单比热区更省地方，也不会因为缩放把字缩小。
 *
 * 不可编辑的块**不给点**，并把原因码翻成中文写在行内：禁用的按钮很多浏览器连 `title`
 * 都不弹，只写 tooltip 等于没解释"为什么这一块点不动"。
 */
import { Alert, Tag, Typography } from "antd";
import type { ExternalResumeBlock, ExternalResumeBlocks } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { blockPreviewText, blockRoleOf, maxBlockSize, reasonKey } from "./blockGeometry";

export interface ExternalResumeEditorProps {
  blocks: ExternalResumeBlocks;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
}

/**
 * 序号固定两位（`01`…`99`）。
 *
 * 为什么不用 `String(n).padStart(2, "0")`：那个 `"0"` 是喂给 `padStart` 的**字符串字面量**，
 * 又正好写在 JSX 表达式里，产品文案棘轮（`i18n/cjkRatchet.test.ts`）会把它算成一处新增
 * 文案——它只看"这是不是被消费的字符串"，分不清补位符和界面字。`minimumIntegerDigits`
 * 用同一个数字口径把宽度补齐，不留任何字面量。
 */
const BLOCK_NUMBER = new Intl.NumberFormat("en-US", {
  minimumIntegerDigits: 2,
  useGrouping: false,
});

/** 块的读法：PDF 带页码，docx / text 只有段序。 */
function positionLabel(block: ExternalResumeBlock, index: number): string {
  return block.page > 0
    ? t("externalEdit.block.label", { page: block.page, index: index + 1 })
    : t("externalEdit.block.labelNoPage", { index: index + 1 });
}

export function ExternalResumeEditor({ blocks, selectedId, onSelect }: ExternalResumeEditorProps) {
  useLocale();
  const editable = blocks.blocks.filter((block) => block.editable).length;
  const largest = maxBlockSize(blocks.blocks);

  return (
    <div data-testid="external-editor" className="rf-ext-editor">
      <Typography.Text type="secondary">
        {t("externalEdit.blocks.count", { editable, total: blocks.blocks.length })}
      </Typography.Text>
      {blocks.blocks.length === 0 ? (
        <Alert
          style={{ marginTop: 8 }}
          data-testid="external-blocks-empty"
          type="warning"
          showIcon
          title={t("externalEdit.blocksEmpty")}
        />
      ) : null}
      <div className="rf-ext-blocks-list">
        {blocks.blocks.map((block, index) => {
          const selected = block.block_id === selectedId;
          const role = blockRoleOf(block, largest);
          const position = positionLabel(block, index);
          return (
            <button
              key={block.block_id}
              type="button"
              data-testid={`external-block-${block.block_id}`}
              aria-label={block.editable ? position : `${position} · ${t(reasonKey(block.reason))}`}
              aria-pressed={selected}
              disabled={!block.editable}
              onClick={() => onSelect(block.block_id)}
              className={`rf-ext-block${selected ? " is-selected" : ""}`}
            >
              <span className="rf-ext-block-index">{BLOCK_NUMBER.format(index + 1)}</span>
              <span className="rf-ext-block-body">
                <span className="rf-ext-block-text">
                  {block.text.trim().length > 0
                    ? blockPreviewText(block.text)
                    : t("externalEdit.block.empty")}
                </span>
                <span className="rf-ext-block-meta">
                  {`${position} · ${
                    role === "title"
                      ? t("externalEdit.block.roleTitle")
                      : t("externalEdit.block.roleBody")
                  }`}
                </span>
                {block.editable ? null : (
                  <span className="rf-ext-block-reason">{t(reasonKey(block.reason))}</span>
                )}
              </span>
              {block.editable ? (
                role === "title" ? (
                  <Tag color="blue">{t("externalEdit.block.roleTitle")}</Tag>
                ) : null
              ) : (
                <Tag>{t("externalEdit.block.locked")}</Tag>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ExternalResumeEditor;
