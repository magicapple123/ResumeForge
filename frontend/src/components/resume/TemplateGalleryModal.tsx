// SPDX-License-Identifier: Apache-2.0
/**
 * 简历模板一览：每个模板都渲染一份真实预览，点一下就直接选用。
 *
 * 之前只有"经典"一种模板，选模板这件事无从比较；现在内置 8 种 + 用户自制模板，
 * 光看名字（"优雅""技术"）猜不出效果，所以这里用真的渲染结果说话。
 *
 * **预览内容固定是内置示例**（2026-10 用户口径）：预览一栏回答的是"这个模板长什么样"，
 * 换成用户自己的简历会让每开一次都触发一份大简历的排版（慢），也让人分不清
 * "这是模板的效果还是我内容的效果"。要看自己的内容，制作台右栏一直是实时预览。
 */
import { App, Button, Empty, Modal, Segmented, Space, Tag, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import A4PreviewFrame from "../templates/A4PreviewFrame";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchResumeTemplates, previewResumeTemplate } from "../../api/resumes";
import type { ResumeFontScale, ResumeLayout, ResumeTemplateOption } from "../../types";
import { t } from "../../i18n";
import { withHiddenScrollbar } from "../../utils/iframeDocument";

interface Props {
  open: boolean;
  layout: ResumeLayout;
  /**
   * 换字号档位 = **改这份简历**（受控）。
   *
   * 以前这个 Segmented 是"只读对比"：选了只影响缩略图，用户按缩略图挑完字号、
   * 回到制作台却发现正文没变。现在它直接写 `layout.font_scale`，所有者负责重排，
   * 于是"选字号"与"看到新字号"是同一次动作。
   *
   * 作用范围只有**当前这份简历**：`font_scale` 是记录级字段，改它不会波及任何其它
   * 已存在的简历（那是"老简历不追溯改变"的前提）。
   */
  onFontScaleChange: (scale: ResumeFontScale) => void;
  onSelect: (template: string) => void;
  onClose: () => void;
}

const FONT_SCALES: { value: ResumeFontScale; label: string }[] = [
  { value: "small", label: "小字号" },
  { value: "standard", label: "标准" },
  { value: "large", label: "大字号" },
];

/** 浅拷贝去掉一个键：`setFailed` 里直接 delete 会改到上一次的 state 对象。 */
function withoutKey(map: Record<string, string>, key: string): Record<string, string> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export default function TemplateGalleryModal({
  open,
  layout,
  onFontScaleChange,
  onSelect,
  onClose,
}: Props) {
  const { message } = App.useApp();
  const [templates, setTemplates] = useState<ResumeTemplateOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  /** 预览请求的世代号：只有最新一轮的结果允许写状态（见下面的预览 effect）。 */
  const previewGeneration = useRef(0);
  /** 「重试」的令牌：+1 就重跑一遍预览取数（失败是逐张的，重试整批最省心）。 */
  const [retryTick, setRetryTick] = useState(0);
  // 字号档位**就是这份简历的档位**（不再另存一份预览档位，见 Props 注释）。
  const previewScale = layout.font_scale ?? "standard";
  // 「查看大图」：整页渲染另取一份（缩略图只渲染 1 页，看不到后面的内容）。
  const [zoomTemplate, setZoomTemplate] = useState<ResumeTemplateOption | null>(null);
  const [zoomHtml, setZoomHtml] = useState("");
  const [zoomLoading, setZoomLoading] = useState(false);
  /** 大图按几页排：与用户设定的「最大篇幅」同口径（后端上限 3）。 */
  const zoomPages = Number(layout.page_limit) || 1;
  // 用户当前真实设定的格式覆盖（含 `font_scale_adjust` 字号系数）。缩略图必须带上它，
  // 否则"用户把字号拖到 14.3px、缩略图却仍是 14px"，选出来才发现不一样。
  const formatConfig = layout.format_config;
  // `format_config` 每次父渲染都是新对象引用，直接放进依赖会让预览随父组件任意重渲染
  // 而反复请求；用序列化签名判断"内容真的变了"。对象本身在闭包里读取。
  const formatConfigKey = JSON.stringify(formatConfig ?? {});

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchTemplates = useCallback(async (): Promise<ResumeTemplateOption[] | null> => {
    try {
      const catalog = await fetchResumeTemplates();
      return catalog.templates;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取模板清单失败");
      return null;
    }
  }, [message]);

  // Compiler 规范：随 open 变化的加载用渲染期守卫；取数在 effect 内联 .then 应用。
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setLoading(true);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchTemplates().then((templates) => {
      if (cancelled) return;
      if (templates !== null) setTemplates(templates);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchTemplates, open]);

  // 预览跟着"字号 + 格式覆盖"走：换档位、换版式、或在外面拖过字号系数后，缩略图
  // 都要一起变，否则用户按缩略图选出来的效果和实际生成的不一致。
  // Compiler 规范：随预览键变化的重置用渲染期守卫；取数留在 effect 的 IIFE 里。
  const previewKey = `${open}:${templates.length}:${formatConfigKey}:${layout.format_name}:${previewScale}`;
  const [prevPreviewKey, setPrevPreviewKey] = useState(previewKey);
  if (prevPreviewKey !== previewKey) {
    setPrevPreviewKey(previewKey);
    // **不清 `previews`**：换字号/换版式时旧缩略图先留着，新图到了再逐张替换。
    // 清空过一次的代价是整屏回到三个灰点——请求一慢（6 个模板并发渲染）看起来就是
    // "一直加载不出来"（2026-10-24 用户反馈）。旧图只是几秒内"偏旧"，比一片空白好。
    // 失败记录要清：换参数后值得再试一次。
    setFailed({});
  }

  useEffect(() => {
    if (!open || templates.length === 0) return;
    // 世代号：只认"最新一轮"的结果。上一轮的请求可能比新一轮慢，放任它写状态会把
    // 新字号/新版式的缩略图覆盖回旧的。
    const generation = previewGeneration.current + 1;
    previewGeneration.current = generation;
    const controller = new AbortController();
    void (async () => {
      await Promise.all(
        templates.map(async (item) => {
          try {
            const html = await previewResumeTemplate({
              template_name: item.name,
              format_name: layout.format_name,
              // 把当前格式覆盖（含字号系数）一并传出：后端把 format_name 的基础版式
              // 与这份 format_config 叠加后再渲染，缩略图因此与用户实际生成的简历同口径。
              format_config: formatConfig,
              page_limit: 1,
              font_scale: previewScale,
              // **刻意不传 `resume_id`**：预览内容是固定示例（见文件头）。
              signal: controller.signal,
            });
            if (previewGeneration.current !== generation) return;
            // 逐张上屏：先回来的先显示，不再等最慢的那一张（`Promise.all` 之后再统一
            // setState 会让 6 张卡一起干等，任何一张慢都表现为"全都加载不出来"）。
            setPreviews((prev) => ({ ...prev, [item.name]: html }));
            setFailed((prev) => withoutKey(prev, item.name));
          } catch (error) {
            if (previewGeneration.current !== generation || controller.signal.aborted) return;
            setFailed((prev) => ({
              ...prev,
              [item.name]: error instanceof Error ? error.message : "预览渲染失败",
            }));
          }
        }),
      );
    })();
    // 关弹窗 / 换参数时把还在飞的请求掐掉：不取消的话它们会占着连接与后端渲染槽。
    return () => controller.abort();
    // format_config 用序列化签名 formatConfigKey 做依赖，避免对象引用每次渲染都变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templates, layout.format_name, formatConfigKey, previewScale, retryTick]);

  const openZoom = useCallback(
    async (template: ResumeTemplateOption) => {
      setZoomTemplate(template);
      setZoomHtml("");
      setZoomLoading(true);
      try {
        setZoomHtml(
          await previewResumeTemplate({
            template_name: template.name,
            format_name: layout.format_name,
            format_config: formatConfig,
            // 用**用户当前设定的页数**（1~3，后端 MAX_RESUME_PAGES 上限即 3）：
            // 大图要看的是"这个模板、这个页数下长什么样"，与导出同口径。
            // 曾经写死 6，直接被后端校验挡下（page_limit 的取值上限是 3）。
            page_limit: zoomPages,
            font_scale: previewScale,
          }),
        );
      } catch (error) {
        message.error(error instanceof Error ? error.message : "预览渲染失败");
        setZoomTemplate(null);
      } finally {
        setZoomLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout.format_name, formatConfigKey, previewScale, zoomPages, message],
  );

  const selectedName = layout.template;
  const body = useMemo(
    () => (
      <div className="template-gallery">
        <div className="template-gallery-toolbar">
          <Typography.Text type="secondary" className="template-gallery-note">
            {t("gallery.preview.demo")}；{t("gallery.fontScale.scope")}
          </Typography.Text>
          {/* 档位是**写回这份简历**的入口（受控）：改它 = 改 `layout.font_scale`，
              制作台右栏会立刻按新字号重排。作用范围只有当前简历与之后新建的简历
              ——`font_scale` 是记录级字段，已保存的其它简历一个都不动。 */}
          <Segmented
            size="small"
            value={previewScale}
            options={FONT_SCALES}
            aria-label={t("gallery.fontScale.label")}
            onChange={(value) => onFontScaleChange(value as ResumeFontScale)}
          />
        </div>
        <div className="template-gallery-grid">
          {templates.map((item) => (
            <div
              key={item.name}
              className={`template-gallery-card${item.name === selectedName ? " is-active" : ""}`}
            >
              <div
                className="template-gallery-preview"
                role="button"
                tabIndex={0}
                aria-label={`查看${item.label}模板大图`}
                onClick={() => void openZoom(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openZoom(item);
                  }
                }}
              >
                {previews[item.name] ? (
                  // 复用 A4PreviewFrame 的 `fit="width"`：宽度决定高度、按实测比例缩放，
                  // 不再写死 `scale(0.36)` —— 卡片宽一变就会左右各裁 4px、右边留白。
                  <A4PreviewFrame
                    html={withHiddenScrollbar(previews[item.name])}
                    title={`${item.label} 预览`}
                    fit="width"
                  />
                ) : failed[item.name] ? (
                  <div className="template-gallery-error">
                    <span>{failed[item.name]}</span>
                    <Button size="small" onClick={() => setRetryTick((tick) => tick + 1)}>
                      {t("gallery.preview.retry")}
                    </Button>
                  </div>
                ) : (
                  <div className="template-gallery-loading">
                    <LoadingBlock size="small" minHeight={120} />
                  </div>
                )}
              </div>
              <div className="template-gallery-meta">
                <div className="template-gallery-title">
                  <span>{item.label}</span>
                  {item.custom ? <Tag color="blue">自制</Tag> : null}
                  {item.name === selectedName ? <Tag color="green">使用中</Tag> : null}
                </div>
                <Typography.Text type="secondary" className="template-gallery-desc">
                  {item.description || "你自制的模板"}
                </Typography.Text>
                <Space size={8}>
                  <Button size="small" onClick={() => void openZoom(item)}>
                    查看大图
                  </Button>
                  <Button
                    size="small"
                    type={item.name === selectedName ? "default" : "primary"}
                    disabled={item.name === selectedName}
                    onClick={() => onSelect(item.name)}
                  >
                    {item.name === selectedName ? "当前使用" : "用这个模板"}
                  </Button>
                </Space>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    [
      templates,
      previews,
      failed,
      selectedName,
      previewScale,
      onSelect,
      onFontScaleChange,
      openZoom,
    ],
  );

  return (
    <Modal
      title="选择简历模板"
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1080px, 96vw)"
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {templates.length === 0 && !loading ? <Empty description="还没有可选模板" /> : body}
      {/* 大图：整页缩放到窗口宽度（`fit="width"`，纸张按「最大篇幅」给足 1–3 页）。
          这里**不再**用固定 794×1123 的 iframe —— 那是"大图界面三个滚动条"的成因：
          弹窗窄于 794px 时出横向滚动条，文档比一页高时 iframe 内部再出一条竖向滚动条，
          加上弹窗本体那条，一共三条。缩放成自适应宽度后，整块只剩弹窗本体一条。 */}
      <Modal
        title={zoomTemplate ? `${zoomTemplate.label} · 完整预览` : "完整预览"}
        open={zoomTemplate !== null}
        onCancel={() => setZoomTemplate(null)}
        // 只留主动作（用这个模板）。先前那颗「关闭」与右上角 × 重复，属于同一弹窗的
        // 第二/第三个关闭入口；Esc 与点遮罩同样映射 onCancel。
        footer={
          zoomTemplate ? (
            <Button
              type="primary"
              disabled={zoomTemplate.name === selectedName}
              onClick={() => {
                onSelect(zoomTemplate.name);
                setZoomTemplate(null);
              }}
            >
              {zoomTemplate.name === selectedName ? "当前使用" : "用这个模板"}
            </Button>
          ) : null
        }
        width="min(900px, 96vw)"
        styles={{
          body: {
            maxHeight: "var(--rf-modal-body-max-h)",
            // 只留竖向滚动：横向由 `fit="width"` 消化掉，`overflowX: hidden` 是
            // 那道保险——纸张宽度就是容器宽度，不该再出现第二条横向滚动条。
            overflowY: "auto",
            overflowX: "hidden",
            // 模板预览底色：深色主题下必须暗下去，否则 iframe 周围是一圈白边。
            background: "var(--rf-surface-alt)",
          },
        }}
        destroyOnHidden
      >
        {zoomLoading ? (
          <div className="template-gallery-zoom-loading">
            <LoadingBlock />
          </div>
        ) : (
          <A4PreviewFrame
            html={withHiddenScrollbar(zoomHtml)}
            title="模板完整预览"
            fit="width"
            pages={zoomPages}
          />
        )}
      </Modal>
    </Modal>
  );
}
