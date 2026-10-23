// SPDX-License-Identifier: Apache-2.0
/**
 * 「查看大图」：全屏工作台，左侧调整排版参数、右侧查看简历效果。
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
  /** 这份简历有没有照片：没有时照片滑杆禁用并说明原因（与大图外面的主预览一致）。 */
  hasPhoto?: boolean;
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
  hasPhoto,
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
  // 结构类参数在工作台左栏集中编辑；主预览仍使用它自己的工具栏插槽。
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
  // 维持 `is-stacked` 的命名与输入布局；工作台侧栏用专属 CSS 把滑杆宽度收进栏宽。
  const measureControls =
    layout && onApplyLayout ? (
      <ResumeMeasureControls
        layout={layout}
        disabled={relayouting}
        catalog={catalog}
        previewRef={zoomPreviewRef}
        hasPhoto={hasPhoto}
        onChange={onApplyLayout}
      />
    ) : undefined;
  const hasSettings = Boolean(templateControls || measureControls);
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
      width="100vw"
      style={{ top: 0, height: "100dvh", maxWidth: "none", margin: 0 }}
      classNames={{ wrapper: "resume-zoom-workbench-wrap" }}
      styles={{
        wrapper: {
          inset: 0,
          display: "flex",
          alignItems: "stretch",
          overflow: "hidden",
          padding: 0,
        },
        container: {
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          maxHeight: "100dvh",
          margin: 0,
          padding: 0,
          borderRadius: 0,
          overflow: "hidden",
        },
        header: { flex: "0 0 auto", marginBottom: 0, borderRadius: 0 },
        body: {
          display: "flex",
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
        },
        footer: { flex: "0 0 auto", marginTop: 0 },
      }}
      destroyOnHidden
    >
      <div className={`resume-zoom-body${hasSettings ? "" : " is-preview-only"}`}>
        {hasSettings ? (
          <div className="resume-zoom-settings">
            {templateControls ? (
              <div className="resume-zoom-settings-template">{templateControls}</div>
            ) : null}
            {measureControls ? (
              <div className="resume-zoom-settings-measure">{measureControls}</div>
            ) : null}
          </div>
        ) : null}
        <div className="resume-zoom-preview-pane">
          <Typography.Paragraph type="secondary" className="resume-zoom-workbench-note">
            按原始尺寸显示，虚线是分页位置（与当前 {pages} 页的设置一致）。缩放用「放大预览」
            「缩小预览」两个按钮，也可以按住 Ctrl 滚滚轮。
          </Typography.Paragraph>
          <div className="resume-zoom-preview-scroll">
            <ResumePreview
              ref={zoomPreviewRef}
              html={html}
              pages={pages}
              warnings={warnings}
              // 大图与主预览共用版式状态和渲染器，左右分栏只改变编辑器布局。
              height={Math.round(window.innerHeight * 0.72)}
              previewMode={previewMode}
              onPreviewModeChange={onPreviewModeChange}
              exactPreview={exactPreview}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
