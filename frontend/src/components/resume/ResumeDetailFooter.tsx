// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览的底部操作条（P2 抽取，P4 改视觉形态）。
 *
 * 从 `ResumeDetailPreview` **逐字搬来**：DOM 结构与 class 名一个字都没改（`.resume-detail-footer`
 * / `.resume-detail-footer-tail` / `.resume-detail-footer-export`），CSS 的网格回填规则
 * 因此原样生效。抽出来的唯一原因是 `ResumeDetailPreview` 已贴到 500 行预算（497），
 * 而 P2 要往里加两个具名插槽（净增）。
 *
 * Props 刻意是**显式集合**而不是整个 `detail`：底部这一条只关心 5 个值（id / 页数版式 /
 * 是否可直出 PDF / 有没有岗位 / 是否已生成建议）。传整个 `detail` 会让这个组件悄悄依赖
 * 更多字段，"改别处、这里跟着变"就查不出来了。所有"打开哪个弹窗"的开关仍留在父组件
 * ——它们与弹窗实例、快捷键、状态初值同处一地。
 */
import {
  BulbOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  ThunderboltOutlined,
  ZoomInOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import type { ReactNode } from "react";
import type { ResumeLayout } from "../../types";
import { t } from "../../i18n";
import ExportButtons from "../ExportButtons";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 简历 id：导出面板与「导出」按钮都按它取数。 */
  resumeId: number;
  /** 当前版式草稿：导出面板要按它预填页数/字号/格式，否则导出的是库里的旧值。 */
  layout: ResumeLayout;
  pdfDirectAvailable: boolean;
  /** 额外操作（如生成弹窗里的「重新生成 / 去简历中心 / 完成」）。 */
  extraActions?: ReactNode;
  /** 是否显示「AI 修改 / 重新生成」。 */
  showRevise: boolean;
  /** 是否已经生成过岗位优化建议：决定按钮文案是「生成」还是「查看」。 */
  suggestionsGenerated: boolean;
  /** 没有对应岗位时「岗位建议」「查看对应岗位」禁用。 */
  jobId: number | null;
  /**
   * 制作台的中栏有未保存的内容：此时禁用「手动调整」。
   *
   * 两个编辑器各持一份 form 实例，同时开会各自往同一份草稿槽位里写，互相覆盖
   * （设计 §9 Q6）。禁用而不是隐藏：位置跳动的代价比"看见但暂时不能点"更大。
   */
  onOpenZoom: () => void;
  onOpenRevise: () => void;
  onOpenSuggestions: () => void;
  onOpenJob: () => void;
  onOpenAssistant: () => void;
  onOpenQuality: () => void;
  onOpenSharePackage: () => void;
  onOpenExportOptions: () => void;
}

export default function ResumeDetailFooter({
  resumeId,
  layout,
  pdfDirectAvailable,
  extraActions,
  showRevise,
  suggestionsGenerated,
  jobId,
  onOpenZoom,
  onOpenRevise,
  onOpenSuggestions,
  onOpenJob,
  onOpenAssistant,
  onOpenQuality,
  onOpenSharePackage,
  onOpenExportOptions,
}: Props) {
  useLocale();
  return (
    // 固定在弹窗底部：内容长（版面诊断 + 预览）时不必一路翻到最后才够得着这些按钮。
    // 按钮区是 CSS Grid：每个按钮独占一格、block 拉满整格，自动铺满整行不留右侧空当。
    <div className="resume-detail-footer">
      <Button block icon={<ZoomInOutlined />} onClick={onOpenZoom}>
        {t("workbench.title")}
      </Button>
      {showRevise && (
        <Button block icon={<ThunderboltOutlined />} onClick={onOpenRevise}>
          {t("resume.footer.revise")}
        </Button>
      )}
      <Button block icon={<BulbOutlined />} disabled={jobId === null} onClick={onOpenSuggestions}>
        {suggestionsGenerated
          ? t("resume.footer.suggestionsView")
          : t("resume.footer.suggestionsGenerate")}
      </Button>
      <Button block icon={<FolderOpenOutlined />} disabled={jobId === null} onClick={onOpenJob}>
        {t("resume.footer.openJob")}
      </Button>
      {/* 「咨询求职助手」上提到**主网格**（2026-11 用户要求）：第一行排满 5 个动作，
          第二行只留「质量检测 / 离线分享」+ 右侧导出，页脚从"4 + 3 + 导出"收成"5 + 2 + 导出"。
          它本来就是和上面四个同级的动作（都是"针对这份简历做点什么"），落在主网格里
          也让它的宽度与上面的按钮逐列对齐。 */}
      <Button block icon={<MessageOutlined />} onClick={onOpenAssistant}>
        {t("resume.footer.assistant")}
      </Button>
      {/* 最后一行：左边两个次动作（质量 / 离线分享）与右边的「取消 / 保存 / 导出」**同一行**。
          这一行是 flex（不是 subgrid）：宽度够时左右同排、右侧贴右；宽度不够时整组换到
          自己的一行再贴右。写死"从第 N 列起"会随主网格列数变化而失效，详见
          `resume-panels.css` 里 `.resume-detail-footer-tail` 的注释。 */}
      <div className="resume-detail-footer-tail">
        <Button block icon={<SafetyCertificateOutlined />} onClick={onOpenQuality}>
          {t("resume.footer.quality")}
        </Button>
        <Button block icon={<ShareAltOutlined />} onClick={onOpenSharePackage}>
          {t("resume.footer.share")}
        </Button>
        {/* 两种形态（D8）：语义不同，不能统一成一种。
          - **没有待确认改动**：导出是"一排动作里的终点"，贴在最右下角最顺手。
          - **有待确认改动**：用户视线在「取消/保存」上，导出若跑到新行只剩最后一格，
            视觉上像"按钮丢了"，所以这时把它们并到**同一行**（左确认 / 右导出）。
          两个分支里只有一个是渲染出来的，所以 `.resume-detail-footer-export` 全页始终
          只有一个（面板的严格模式依赖这一点）。 */}
        {extraActions ? (
          <div className="resume-detail-footer-confirm-row">
            <div className="resume-detail-footer-extra">{extraActions}</div>
            <div className="resume-detail-footer-export">
              <ExportButtons
                recordId={resumeId}
                layout={layout}
                pdfDirectAvailable={pdfDirectAvailable}
                onOpen={onOpenExportOptions}
              />
            </div>
          </div>
        ) : (
          <div className="resume-detail-footer-export">
            <ExportButtons
              recordId={resumeId}
              layout={layout}
              pdfDirectAvailable={pdfDirectAvailable}
              onOpen={onOpenExportOptions}
            />
          </div>
        )}
      </div>
    </div>
  );
}
