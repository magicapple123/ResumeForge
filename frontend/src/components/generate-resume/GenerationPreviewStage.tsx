/** 生成预览阶段：ResumeDetailPreview 组合 + extraActions 三按钮。
 *
 * 纯展示——版式状态/预览句柄/保存与修订回调全部由 GenerateResumeModal 经 props 回传；
 * 去简历中心的 navigate 经 onGoResumes 下传（子文件不持有 Router 钩子）；零 api 导入。
 */
import { ReloadOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";
import type { RefObject } from "react";
import ResumeDetailPreview from "../resume/ResumeDetailPreview";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../../types";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";

/** 生成完成的简历记录：直接持有完整 detail，预览阶段与简历中心共享同一套界面（B3）。 */
export interface GenerateResult {
  detail: ResumeDetail;
}

interface Props {
  result: GenerateResult;
  previewHtml: string;
  layout: ResumeLayout;
  layoutStatus: { pages: number; scale: number; overflow: boolean } | null;
  measure: LayoutMeasure | null;
  pdfDirectAvailable: boolean;
  relayouting: boolean;
  previewRef: RefObject<ResumePreviewHandle | null>;
  setLayoutStatus: (status: { pages: number; scale: number; overflow: boolean } | null) => void;
  setMeasure: (measure: LayoutMeasure | null) => void;
  applyLayout: (next: ResumeLayout) => void;
  applyFittedFormat: (formatConfig: ResumeFormatConfig) => void;
  saveEditedResume: (content: ResumeContent) => Promise<void>;
  applyRevisedDetail: (updated: ResumeDetail) => Promise<void>;
  suggestionsGenerated: boolean;
  suggestionsResetKey: number;
  setSuggestionsGenerated: (value: boolean) => void;
  onGoResumes: () => void;
  onRegenerate: () => void;
  onClose: () => void;
}

export default function GenerationPreviewStage({
  result,
  previewHtml,
  layout,
  layoutStatus,
  measure,
  pdfDirectAvailable,
  relayouting,
  previewRef,
  setLayoutStatus,
  setMeasure,
  applyLayout,
  applyFittedFormat,
  saveEditedResume,
  applyRevisedDetail,
  suggestionsGenerated,
  suggestionsResetKey,
  setSuggestionsGenerated,
  onGoResumes,
  onRegenerate,
  onClose,
}: Props) {
  return (
    <ResumeDetailPreview
      detail={result.detail}
      html={previewHtml}
      layout={layout}
      layoutStatus={layoutStatus}
      measure={measure}
      pdfDirectAvailable={pdfDirectAvailable}
      relayouting={relayouting}
      previewRef={previewRef}
      onLayoutStatus={setLayoutStatus}
      onMeasure={setMeasure}
      onApplyLayout={applyLayout}
      onApplyFittedFormat={applyFittedFormat}
      onSaveEditedResume={saveEditedResume}
      onResumeRevised={applyRevisedDetail}
      showReviseAction={false}
      suggestionsGenerated={suggestionsGenerated}
      suggestionsResetKey={suggestionsResetKey}
      onSuggestionsGenerated={() => setSuggestionsGenerated(true)}
      extraActions={
        <Space wrap>
          <Button onClick={onGoResumes}>去简历中心</Button>
          <Button icon={<ReloadOutlined />} onClick={onRegenerate}>
            重新生成
          </Button>
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        </Space>
      }
    />
  );
}
