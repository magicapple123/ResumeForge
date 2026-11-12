// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台中栏（v2）：DocumentEditor + 旧简历转换提示。
 *
 * 编辑器是受控的：所有改动经 onChange 回到宿主（工作台把它记进历史并标脏）；
 * 中栏不再持有表单实例，也没有第二份文档。
 *
 * 转换提示（backend ResumeOut.document_conversion）：旧简历第一次被读取时后端会做 v1→v2
 * 转换，这里把摘要显式告诉用户（识别了多少字段 / 保留了多少行 / 有哪些提醒），
 * 保存成功后宿主把 conversion 置空，提示自然消失。
 */
import { Alert, Button, Typography } from "antd";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type { DocumentConversionSummary, ResumeLayout } from "../../../types/resume";
import type {
  DocumentFieldCatalog,
  ResumeDocument,
  ResumeSection,
} from "../../../types/resumeDocument";
import { addSection } from "../document/mutations";
import { defaultSectionLayout } from "../document/defaults";
import { newObjectId } from "../document/identity";
import AddSectionModal from "./AddSectionModal";
import DocumentEditor from "./DocumentEditor";
import { EMPTY_FACT_ANNOTATIONS, FactSourceContext } from "./factSourceContext";
import type { FactAnnotation } from "../../../types";
import "./workbench-v2.css";

export interface ResumeWorkbenchV2EditorColumnProps {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  onHoverPath?: (path: string | null) => void;
  /** 选中变化序号：变化时把对应条目卡滚到可视区顶部（R-14）。 */
  revealNonce?: number;
  readOnly?: boolean;
  fieldCatalog?: DocumentFieldCatalog | null;
  /** #7：右键「调整排版」浮层的版式通道。 */
  layout?: ResumeLayout | null;
  onLayoutChange?: (next: ResumeLayout) => void;
  /** 旧简历转换摘要；null/缺省 = 不显示（本来就是 v2 或保存后）。 */
  conversion?: DocumentConversionSummary | null;
  onDismissConversion?: () => void;
  /** 中栏顶部的「从资料填入」入口（ProfileFillMenu；由宿主构造，组件本身只读文档+onChange）。 */
  fillMenu?: ReactNode;
  /** #19：编辑器右键「收藏当前要点」→ 宿主收藏（不传 = 菜单不出现该项）。 */
  onCollectAsset?: (path: string) => void;
  /**
   * #24 24E：这份简历的事实来源标注（`detail.fact_annotations`），字段旁徽标用。
   * 与预览卡顶部「来源」弹层**同一份数据**（宿主只取一次详情），这一层不发请求。
   */
  factAnnotations?: readonly FactAnnotation[] | null;
}

export default function ResumeWorkbenchV2EditorColumn({
  document,
  onChange,
  selectedPath,
  onSelectPath,
  onHoverPath,
  revealNonce = 0,
  readOnly = false,
  fieldCatalog = null,
  layout = null,
  onLayoutChange,
  conversion = null,
  onDismissConversion,
  fillMenu = null,
  onCollectAsset,
  factAnnotations = null,
}: ResumeWorkbenchV2EditorColumnProps) {
  useLocale();
  const [summaryOpen, setSummaryOpen] = useState(false);
  /**
   * 任务 11：「新建板块（仅本份简历）」。
   *
   * 入口只有一个（页签末尾的「+」），所以状态放在中栏自己身上——宿主 `ResumeWorkbenchV2`
   * 已经在 500 行预算边缘，再往那里加一个 state + 一个弹窗就超了。
   *
   * 写回走 `onChange`（宿主 = `history.recordDraft`）：它按 `summarizeChange` 分类，
   * `section-add` 是既有的独立类型，所以新增板块天然是一条可撤销的历史步骤，
   * 不需要 `commitDocument` 才能得到同样的效果。
   */
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  /**
   * 问题 14：提示条的浮层宿主。必须是 `.document-editor`（滚动容器）**之外的**节点：
   * 挂进去就跟着内容一起滚，等于没改。用 ref callback 存 state 是为了让
   * `DocumentEditor` 在首次挂载后拿到真实节点（`useRef.current` 变化不触发重渲染）。
   */
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);
  const attachNoticeHost = useCallback((node: HTMLDivElement | null) => setNoticeHost(node), []);
  const createSection = (title: string) => {
    const section: ResumeSection = {
      key: `custom:${newObjectId()}`,
      title,
      kind: "entries",
      layout: defaultSectionLayout(),
      entries: [],
    };
    onChange(addSection(document, section));
    // 切到新板块：`DocumentEditor` 的页签跟随 `selectedPath` 所属板块自动切换。
    onSelectPath?.(section.key);
  };
  const warnings = conversion?.warnings ?? [];
  return (
    <div className="resume-wb-v2-editor">
      <AddSectionModal
        open={addSectionOpen}
        onClose={() => setAddSectionOpen(false)}
        onCreate={createSection}
      />
      {conversion ? (
        <Alert
          type="info"
          showIcon
          className="resume-wb-v2-conversion"
          title={t("document.conversion.title")}
          description={
            <div className="resume-wb-v2-conversion-body">
              <div>{t("document.conversion.body")}</div>
              <div className="resume-wb-v2-conversion-actions">
                <Button size="small" type="link" onClick={() => setSummaryOpen((open) => !open)}>
                  {t("document.conversion.summary")}
                </Button>
                {onDismissConversion ? (
                  <Button size="small" type="link" onClick={onDismissConversion}>
                    {t("document.conversion.dismiss")}
                  </Button>
                ) : null}
              </div>
              {summaryOpen ? (
                <div className="resume-wb-v2-conversion-summary">
                  <div>
                    {t("structure.conversion.fields", { count: conversion.fields_recognized })}
                  </div>
                  <div>
                    {t("structure.conversion.lines", { count: conversion.lines_preserved })}
                  </div>
                  {conversion.empty_sections.length > 0 ? (
                    <div>
                      {t("structure.conversion.emptySections", {
                        sections: conversion.empty_sections.join("\u3001"),
                      })}
                    </div>
                  ) : null}
                  {warnings.length > 0 ? (
                    <div>
                      <Typography.Text strong>{t("structure.conversion.warnings")}</Typography.Text>
                      <ul>
                        {warnings.map((warning, index) => (
                          <li key={`${index}-${warning}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
        />
      ) : null}
      {fillMenu ? <div className="resume-wb-v2-fill-menu">{fillMenu}</div> : null}
      {/* #24 24E：标注走 context，而不是给 DocumentEditor 加 prop——那个文件正好 500 行，
          而 chip 在它下面三层，透传要改四处签名。空表用模块级常量（引用稳定，不会让
          上百个 chip 因"新的空数组"重渲染）。 */}
      <FactSourceContext.Provider value={factAnnotations ?? EMPTY_FACT_ANNOTATIONS}>
        <DocumentEditor
          document={document}
          onChange={onChange}
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
          onHoverPath={onHoverPath}
          revealNonce={revealNonce}
          readOnly={readOnly}
          fieldCatalog={fieldCatalog}
          layout={layout}
          onLayoutChange={onLayoutChange}
          onAddSection={() => setAddSectionOpen(true)}
          onCollectAsset={onCollectAsset}
          noticeHost={noticeHost}
        />
      </FactSourceContext.Provider>
      {/* 问题 14：中栏底部的提示浮层宿主——在滚动容器之外，提示不随内容滚走。 */}
      <div className="resume-wb-notice-host" ref={attachNoticeHost} />
    </div>
  );
}
