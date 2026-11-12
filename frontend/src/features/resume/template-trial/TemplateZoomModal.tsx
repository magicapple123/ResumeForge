// SPDX-License-Identifier: Apache-2.0
/**
 * 模板「完整预览」（大图）：**固定一张 A4 纸**。
 *
 * 2026-10-31 R-02：以前这里按「最大篇幅」渲染 1–3 页、`fit="width"` 让纸铺满弹窗宽度，
 * 于是弹窗里出现的是一条 3600px 高的长图——纸的下沿永远在视口之外，用户滚 4 屏才看得到
 * 底边，也看不出「这是一张纸」。现在固定只渲染 1 页、`fit="contain"` 让整张纸缩进可视区，
 * 纸外面再包一层 20px 的灰底，纸自己带 1px 描边与投影：一眼就是"一张 A4 纸"。
 *
 * 从 `TemplateGalleryModal` 抽出来（那个文件已有 480+ 行，接近 500 行预算）：大图有自己的
 * 取数、加载态与关闭语义，和画廊的缩略图网格没有共享状态。
 */
import { App, Button, Modal } from "antd";
import { useEffect, useState } from "react";
import LoadingBlock from "../../../components/common/LoadingBlock";
import A4PreviewFrame from "../../templates/A4PreviewFrame";
import { previewResumeTemplate } from "../../../api/resumes";
import type { ResumeFontScale, ResumeFormatConfig, ResumeTemplateOption } from "../../../types";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { withHiddenScrollbar } from "../../../utils/iframeDocument";

interface Props {
  /** 要放大的模板；`null` = 关闭。 */
  template: ResumeTemplateOption | null;
  /** 当前基础版式（与缩略图、导出同口径）。 */
  formatName: string;
  formatConfig?: ResumeFormatConfig;
  fontScale: ResumeFontScale;
  /** 已经选用的模板名：决定 footer 那颗按钮是「用这个模板」还是「当前使用」。 */
  selectedName: string;
  onSelect: (template: string) => void;
  onClose: () => void;
}

export default function TemplateZoomModal({
  template,
  formatName,
  formatConfig,
  fontScale,
  selectedName,
  onSelect,
  onClose,
}: Props) {
  // 模块级 `t()` 不订阅 React context：缺这一行时切语言，这个弹窗会一直停在上一种语言。
  useLocale();
  const { message } = App.useApp();
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const name = template?.name ?? null;
  // `format_config` 每次父渲染都是新对象引用；用序列化签名判断"它真的变了"。
  const formatConfigKey = JSON.stringify(formatConfig ?? {});

  useEffect(() => {
    if (!name) {
      setHtml("");
      return;
    }
    let cancelled = false;
    setHtml("");
    setLoading(true);
    void (async () => {
      try {
        const next = await previewResumeTemplate({
          template_name: name,
          format_name: formatName,
          format_config: formatConfig,
          // **固定 1 页**：大图回答的是"这张纸长什么样"，不是"这份简历有几页"。
          page_limit: 1,
          font_scale: fontScale,
        });
        if (cancelled) return;
        setHtml(next);
      } catch (error) {
        if (cancelled) return;
        message.error(error instanceof Error ? error.message : t("gallery.preview.failed"));
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // format_config 用序列化签名做依赖（避免对象引用每次渲染都变而反复取数）；
    // onClose 是宿主的内联箭头函数，列进依赖会让每次父渲染都重取一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, formatName, formatConfigKey, fontScale]);

  return (
    <Modal
      title={
        template
          ? t("gallery.zoom.titleWithName", { name: template.label })
          : t("gallery.zoom.title")
      }
      open={template !== null}
      onCancel={onClose}
      // 只留主动作（用这个模板）。Esc 与点遮罩同样映射 onCancel。
      footer={
        template ? (
          <Button
            type="primary"
            disabled={template.name === selectedName}
            onClick={() => {
              onSelect(template.name);
              onClose();
            }}
          >
            {template.name === selectedName ? t("gallery.status.current") : t("gallery.action.use")}
          </Button>
        ) : null
      }
      width="min(900px, 96vw)"
      styles={{
        body: {
          // 高度上限留给纸：灰底由 `.template-gallery-zoom` 提供，body 自己不留内边距。
          maxHeight: "var(--rf-modal-body-max-h)",
          overflowY: "auto",
          overflowX: "hidden",
          padding: 0,
        },
      }}
      destroyOnHidden
    >
      {/* 灰底包住加载态与纸，避免"先白后灰"闪一下。 */}
      <div className="template-gallery-zoom">
        {loading ? (
          <div className="template-gallery-zoom-loading">
            <LoadingBlock />
          </div>
        ) : (
          <A4PreviewFrame
            html={withHiddenScrollbar(html)}
            title={t("gallery.zoom.frameTitle")}
            // contain：整张 A4 一次看全（高度上限扣掉灰底那 40px 内边距）。
            fit="contain"
            maxHeight="calc(var(--rf-modal-body-max-h) - 40px)"
            pages={1}
          />
        )}
      </div>
    </Modal>
  );
}
