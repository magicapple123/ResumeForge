// SPDX-License-Identifier: Apache-2.0
/**
 * 「查看大图」：把简历放到一个大窗口里按 1:1 看。
 *
 * 为什么不复用外面的预览：外面那份为了塞进列表页，视口高度只有几百像素、还带缩放，
 * "这一页到底排得满不满、分页在哪"看不清。这里换一个大视口重新量一次，页面就是原尺寸。
 *
 * 复用同一个 `ResumePreview` 组件（而不是再写一个渲染器）是刻意的：两份实现迟早会在
 * 分页、缩放、编辑定位这些细节上分叉，而"看到的和导出的一致"正是这一块的全部意义。
 */
import { DownloadOutlined } from "@ant-design/icons";
import { Button, Modal, Space, Typography } from "antd";
import { useRef } from "react";
import type { ResumeLayout } from "../../types";
import { useResumeTemplateCatalog } from "../../hooks/useResumeTemplateCatalog";
import ResumePreview, {
  type ExactPreviewOptions,
  type ResumePreviewHandle,
} from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import ResumeMeasureControls from "./ResumeMeasureControls";
import ResumeTemplateControls from "./ResumeTemplateControls";

interface Props {
  open: boolean;
  html: string;
  warnings: string[];
  /** 与记录里的页数上限一致；预览里那几根虚线就是按它切的。 */
  pages: number;
  onClose: () => void;
  /** 版式控件（与主预览同一份状态）：在大图里也能边走边调。 */
  layout?: ResumeLayout;
  resumeId?: number;
  relayouting?: boolean;
  onApplyLayout?: (next: ResumeLayout) => void;
  onExport?: () => void;
  previewRef?: React.RefObject<ResumePreviewHandle | null>;
  /**
   * 大图与主预览**共用同一份口径**（2026-10-21 用户要求）：主预览在草稿，大图就是草稿；
   * 主预览在精确，大图就是精确。切换也双向同步——在大图里切回草稿，外面跟着变。
   */
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 精确预览所需的上下文（与大图外面的那一份逐字段相同）。 */
  exactPreview?: ExactPreviewOptions;
}

export default function ResumeZoomModal({
  open,
  html,
  warnings,
  pages,
  onClose,
  layout,
  resumeId,
  relayouting = false,
  onApplyLayout,
  onExport,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
}: Props) {
  // 大图有自己的预览实例：字号滑块要即时作用在**这一个** iframe 上，不能借用主预览的句柄。
  // 调用方给了 ref 就用它（不再在 ref 回调里二次赋值——Compiler 禁止渲染后再改 ref）。
  const fallbackPreviewRef = useRef<ResumePreviewHandle>(null);
  const zoomPreviewRef = previewRef ?? fallbackPreviewRef;
  // 目录**只取一次**，两个插槽共用（`useApi` 没有跨实例缓存，各取一次就是两个请求）。
  const { catalog } = useResumeTemplateCatalog();
  // 大图里同样要有两行工具栏 + 纸面下方的缩放条，否则"大图"里调不了版式也放不大。
  // 同上：结构类控件也不走紧凑形态，与主预览的第一行保持一致。
  const templateControls =
    layout && onApplyLayout ? (
      <ResumeTemplateControls
        layout={layout}
        resumeId={resumeId}
        disabled={relayouting}
        catalog={catalog}
        onChange={onApplyLayout}
      />
    ) : undefined;
  // 不加 `compact`（2026-10-21 用户截图）：紧凑形态下三条滑杆是"吃掉剩余宽度"的，
  // 大图弹窗更宽，于是行距/页边距只有 56px、字号 213px，与外面主预览的 200px 对不上。
  // 大图与主预览必须是**同一种形态**（`is-stacked`），否则同一组控件在两处看起来像两套。
  const measureControls =
    layout && onApplyLayout ? (
      <ResumeMeasureControls
        layout={layout}
        disabled={relayouting}
        catalog={catalog}
        previewRef={zoomPreviewRef}
        onChange={onApplyLayout}
      />
    ) : undefined;
  return (
    <Modal
      title="查看简历大图"
      open={open}
      onCancel={onClose}
      // 操作区走 Modal 的真 footer 插槽：此前「导出 / 关闭」贴在正文末尾，正文因此长出一条
      // 假底栏（滚动时跟着内容一起走，与全站其它弹窗的底部操作区不一致）。
      // 关闭只剩右上角的 × 一个入口（Esc / 点遮罩同样映射 onCancel，见 Modal 的默认行为）。
      footer={
        onExport ? (
          <Space>
            <Button icon={<DownloadOutlined />} onClick={onExport}>
              导出
            </Button>
          </Space>
        ) : null
      }
      width="min(1240px, 96vw)"
      // 弹窗自身滚动：预览的纵向空间本来就归外层管理（见 ResumePreview），内容比视口高时
      // 只滚这里，卡片整体始终完整呈现在视口内，不再需要在弹窗外整页滚动。
      styles={{
        body: {
          maxHeight: "var(--rf-modal-body-max-h)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingTop: 8,
        },
      }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        按原始尺寸显示，虚线是分页位置（与当前 {pages} 页的设置一致）。缩放用纸面下方的控件，
        也可以按住 Ctrl 滚滚轮。
      </Typography.Paragraph>
      <div className="resume-zoom-body">
        <ResumePreview
          ref={zoomPreviewRef}
          templateControls={templateControls}
          measureControls={measureControls}
          html={html}
          pages={pages}
          warnings={warnings}
          // 视角更大：占满窗口高度，页面就能以 1:1 显示（不必再缩到 0.x 倍）。
          height={Math.round(window.innerHeight * 0.72)}
          previewMode={previewMode}
          onPreviewModeChange={onPreviewModeChange}
          exactPreview={exactPreview}
        />
      </div>
    </Modal>
  );
}
