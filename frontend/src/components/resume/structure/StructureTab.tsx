// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏「本份简历结构」页签的**整块内容**（#24 24D 抽出）。
 *
 * 三块从上到下：结构树 → 未收录资料（24D）→ 条目字段排版。抽出成独立文件的直接原因是
 * 行数预算：`WorkbenchParamsColumnV2` 已经到 481 行（500 行红线），而这一块本来就是
 * "同一份 document 的三个视图"，宿主只需要一行 `<StructureTab … />`。
 *
 * 抽出时**行为一字未改**：滚动容器仍是 `.resume-wb-v2-panel.resume-wb-structure-tab`
 * 且带 `data-panel-scroll="structure"`（`usePanelScrollAnchor` 与既有用例都按它定位），
 * 结构树的回调接线、只读宿主口径、字段目录的中文标签回退都原样搬过来。
 *
 * 为什么"未收录"组放在结构树**下面**而不是最上面：结构树是这一页签的主线（用户点页签
 * 就是为了看结构），把一块"还有东西没进来"的清单压在最上会挡住主线；它在树下面紧邻
 * 「条目字段排版」，正好接着"补进来的条目现在长什么样"这条阅读顺序。
 */
import { useCallback } from "react";
import type { ReactNode } from "react";
import { Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { DocumentFieldCatalog, ResumeDocument } from "../../../types/resumeDocument";
import StructurePanel from "./StructurePanel";
import CoverageStructureGroup from "./CoverageStructureGroup";
import EntryLayoutPanel from "../EntryLayoutPanel";
import { usePanelScrollAnchor } from "../entryLayout/usePanelScrollAnchor";

export interface StructureTabProps {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  pickTarget?: { path: string; nonce: number } | null;
  canvasContainer?: HTMLElement | null;
  onNotify?: (message: string) => void;
  pagesNeeded?: number | null;
  /** 结构树条目行右键「排版整条…」：范围由宿主决定（整条）。 */
  onRequestEntryStyle?: (path: string, x: number, y: number) => void;
  /** 只读宿主（无正文的生成预览）：结构树不渲染勾选框，也不能改文档。 */
  readOnly?: boolean;
  multiSelectedPaths?: string[];
  onMultiSelectedPathsChange?: (paths: string[]) => void;
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 「我的资料」板块顺序（已翻成文档 key）；结构面板「顺序」里的同步按钮用。 */
  profileSectionOrder?: readonly string[];
  /** 版式保存/重排在飞：条目排版面板据此禁用。 */
  relayouting?: boolean;
  /** 记录 id / 版本：24D 的未收录清单与「补进简历」的条件写都要它。 */
  resumeId?: number | null;
  revision?: number | null;
  /** 结构树之外的尾部插槽（当前没有使用方；留给宿主做"页签内嵌面板"）。 */
  footer?: ReactNode;
}

export default function StructureTab({
  document,
  onChange,
  selectedPath,
  onSelectPath,
  pickTarget,
  canvasContainer,
  onNotify,
  pagesNeeded,
  onRequestEntryStyle,
  readOnly = false,
  multiSelectedPaths,
  onMultiSelectedPathsChange,
  fieldCatalog,
  profileSectionOrder,
  relayouting = false,
  resumeId,
  revision,
  footer,
}: StructureTabProps) {
  // 用了模块级 `t()` 就必须订阅语言变化（`localeSubscription` 守卫）。
  useLocale();
  /** R-10：改动后重排时把 scrollTop 写回去，内容不上下跳。 */
  const scrollRef = usePanelScrollAnchor<HTMLDivElement>(document);
  /**
   * Q20：字段没有值时结构树显示字段目录里的中文标签（目录缺失时恒为 false）。
   *
   * 用 `useCallback` 而不是 `useMemo` 返回一个闭包：React Compiler 能保住前者，
   * 后者会被判成"无法保留的手工 memo"（lint 报错）。
   */
  const isMaterialOnlyField = useCallback(
    (key: string): boolean => {
      if (!fieldCatalog) return false;
      for (const section of fieldCatalog.sections) {
        const field = section.fields.find((candidate) => candidate.key === key);
        if (field) return field.material_only;
      }
      return false;
    },
    [fieldCatalog],
  );
  return (
    <div
      ref={scrollRef}
      className="resume-wb-v2-panel resume-wb-structure-tab"
      data-panel-scroll="structure"
    >
      <StructurePanel
        document={document}
        onChange={onChange}
        selectedPath={selectedPath}
        onSelectPath={onSelectPath}
        pickTarget={pickTarget}
        canvasContainer={canvasContainer}
        onNotify={onNotify}
        pagesNeeded={pagesNeeded}
        // #7：条目行右键「排版整条…」→ 宿主的浮层状态（范围整条）。
        onRequestEntryStyle={onRequestEntryStyle}
        readOnly={readOnly}
        multiSelectedPaths={multiSelectedPaths}
        onMultiSelectedPathsChange={onMultiSelectedPathsChange}
        fieldCatalog={fieldCatalog}
        profileSectionOrder={profileSectionOrder}
        isMaterialOnlyField={isMaterialOnlyField}
      />
      {/* #24 24D：未收录资料（补进来 / 去中栏改写），自取 detail，不额外要宿主传参。 */}
      <CoverageStructureGroup resumeId={resumeId} revision={revision} onNotify={onNotify} />
      {/* T7b/U1：条目与字段排版并入结构页签（原独立「条目字段排版」分组已删除），
          结构树选中条目后这里跟随同一 selectedPath。 */}
      <section className="resume-wb-structure-layout" aria-label={t("structure.layout.title")}>
        <Typography.Text strong>{t("structure.layout.title")}</Typography.Text>
        <EntryLayoutPanel
          document={document}
          onChange={onChange}
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
          fieldCatalog={fieldCatalog}
          onNotice={onNotify}
          disabled={relayouting}
        />
      </section>
      {footer}
    </div>
  );
}
