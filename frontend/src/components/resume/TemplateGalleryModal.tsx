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
import type {
  ResumeContent,
  ResumeFontScale,
  ResumeFormatConfig,
  ResumeLayout,
  ResumeTemplateCatalog,
  ResumeTemplateOption,
} from "../../types";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { withHiddenScrollbar } from "../../utils/iframeDocument";
import { templateCapability } from "../../features/resume-template-trial/templateProfile";
import TemplateTrialPanel from "./template-trial/TemplateTrialPanel";

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
  /**
   * 试用采纳通道（W10）：提供时"采用模板默认"才可用——它需要把**清空后的**
   * `format_config` 也交给宿主一次写回。不提供时退回 `onSelect(template)`（保留覆盖），
   * 对比视图会如实禁用"采用模板默认"，不假装生效。
   */
  onTrialAdopt?: (request: { template: string; formatConfig: ResumeFormatConfig }) => void;
  /** 当前简历 id：试用"我的内容 + 真实页数"需要。不传时只能看示例。 */
  resumeId?: number | null;
  /** 未保存的当前正文（W04 覆盖）：试用按它预览与测量，不落库。 */
  content?: ResumeContent | null;
}

const FONT_SCALES: { value: ResumeFontScale; labelKey: MessageKey }[] = [
  { value: "small", labelKey: "gallery.fontScale.small" },
  { value: "standard", labelKey: "gallery.fontScale.standard" },
  { value: "large", labelKey: "gallery.fontScale.large" },
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
  onTrialAdopt,
  resumeId,
  content,
}: Props) {
  const locale = useLocale();
  const { message } = App.useApp();
  const [templates, setTemplates] = useState<ResumeTemplateOption[]>([]);
  /** 完整目录（对比视图要读 `template_layouts` 推篇幅档，不另发一次请求）。 */
  const [catalog, setCatalog] = useState<ResumeTemplateCatalog | null>(null);
  /** 图库 / 试用对比：同一弹窗内切视图，不叠第二个 Modal（叠层规则）。 */
  const [view, setView] = useState<"gallery" | "compare">("gallery");
  /** 从某张卡片点"试用"进来时，右侧默认就是那张卡。 */
  const [trialSeed, setTrialSeed] = useState<string | null>(null);
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
  const fetchTemplates = useCallback(async (): Promise<ResumeTemplateCatalog | null> => {
    try {
      return await fetchResumeTemplates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("gallery.catalog.loadFailed"));
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
    void fetchTemplates().then((nextCatalog) => {
      if (cancelled) return;
      if (nextCatalog !== null) {
        setCatalog(nextCatalog);
        setTemplates(nextCatalog.templates);
      }
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
              [item.name]: error instanceof Error ? error.message : t("gallery.preview.failed"),
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
        message.error(error instanceof Error ? error.message : t("gallery.preview.failed"));
        setZoomTemplate(null);
      } finally {
        setZoomLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout.format_name, formatConfigKey, previewScale, zoomPages, message],
  );

  /** 一张卡片的能力摘要（纯展示；目录缺基准时只显示能证实的两项）。 */
  const cardCapability = useCallback(
    (item: ResumeTemplateOption): string => {
      const capability = templateCapability(item, catalog);
      const chips = [
        capability.density === "roomy"
          ? t("trial.density.roomy")
          : capability.density === "regular"
            ? t("trial.density.regular")
            : null,
        t(capability.photo === "custom" ? "trial.photo.custom" : "trial.photo.builtin"),
      ].filter((chip): chip is string => Boolean(chip));
      return chips.join(" · ");
    },
    [catalog],
  );

  const selectedName = layout.template;
  const body = useMemo(() => {
    // The gallery body contains translated labels and must rebuild on locale changes.
    void locale;
    return (
      <div className="template-gallery">
        <div className="template-gallery-toolbar">
          <Typography.Text type="secondary" className="template-gallery-note">
            {t("gallery.preview.demo")}
            {t("gallery.toolbar.separator")}
            {t("gallery.fontScale.scope")}
          </Typography.Text>
          {/* 导出支持/格式差异是**格式级**事实，按 W11 矩阵在"试用与对比"里显示，
              不在每张卡片上各写一句（那会是第二份能力判定）。 */}
          <Typography.Text type="secondary" className="template-gallery-note">
            {t("trial.capability.more")}
          </Typography.Text>
          {/* 档位是**写回这份简历**的入口（受控）：改它 = 改 `layout.font_scale`，
              制作台右栏会立刻按新字号重排。作用范围只有当前简历与之后新建的简历
              ——`font_scale` 是记录级字段，已保存的其它简历一个都不动。 */}
          <Segmented
            size="small"
            value={previewScale}
            options={FONT_SCALES.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
            aria-label={t("gallery.fontScale.label")}
            onChange={(value) => onFontScaleChange(value as ResumeFontScale)}
          />
          {/* W10：进入"试用与对比"视图（同一弹窗内切视图，不叠第二个 Modal）。 */}
          <Button
            size="small"
            onClick={() => {
              setTrialSeed(null);
              setView("compare");
            }}
          >
            {t("trial.action.open")}
          </Button>
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
                aria-label={t("gallery.zoom.openAria", { name: item.label })}
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
                    title={t("gallery.preview.iframeTitle", { name: item.label })}
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
                  {item.custom ? <Tag color="blue">{t("gallery.badge.custom")}</Tag> : null}
                  {item.name === selectedName ? (
                    <Tag color="green">{t("gallery.status.inUse")}</Tag>
                  ) : null}
                </div>
                <Typography.Text type="secondary" className="template-gallery-desc">
                  {item.description || t("gallery.card.customDescription")}
                </Typography.Text>
                {/* W10 能力卡片：篇幅（后端 density_group 同判据）/ 照片 / 栏目 / 导出。
                    数据全部从目录投影，不写死第二份模板档案。 */}
                <Typography.Text type="secondary" className="template-gallery-capability">
                  {cardCapability(item)}
                </Typography.Text>
                <Space size={8}>
                  {/* 「查看大图」暂时保留中文字面量：`workbenchRenameGuard.test.ts` 要求这串文案
                      去注释后仍然只出现在本文件里，改成 t() 会让那条守卫变红。 */}
                  <Button size="small" onClick={() => void openZoom(item)}>
                    查看大图
                  </Button>
                  {/* W10：只试用这一套（右侧预填），不直接改这份简历。 */}
                  <Button
                    size="small"
                    onClick={() => {
                      setTrialSeed(item.name);
                      setView("compare");
                    }}
                  >
                    {t("trial.action.try")}
                  </Button>
                  <Button
                    size="small"
                    type={item.name === selectedName ? "default" : "primary"}
                    disabled={item.name === selectedName}
                    onClick={() => onSelect(item.name)}
                  >
                    {item.name === selectedName
                      ? t("gallery.status.current")
                      : t("gallery.action.use")}
                  </Button>
                </Space>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }, [
    templates,
    previews,
    failed,
    selectedName,
    previewScale,
    onSelect,
    onFontScaleChange,
    openZoom,
    cardCapability,
    locale,
  ]);

  return (
    <Modal
      title={t("gallery.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1080px, 96vw)"
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {view === "compare" ? (
        <TemplateTrialPanel
          layout={layout}
          catalog={catalog ?? undefined}
          resumeId={resumeId}
          content={content}
          initialTemplate={trialSeed}
          canResetOverrides={Boolean(onTrialAdopt)}
          onBack={() => setView("gallery")}
          onAdopt={(request) => {
            if (onTrialAdopt) {
              onTrialAdopt(request);
            } else {
              // 宿主没接试用通道：退回原有 onSelect（保留覆盖），不假装"采用模板默认"。
              onSelect(request.template);
            }
            setView("gallery");
          }}
        />
      ) : templates.length === 0 && !loading ? (
        <Empty description={t("gallery.empty.noTemplates")} />
      ) : (
        body
      )}
      {/* 大图：整页缩放到窗口宽度（`fit="width"`，纸张按「最大篇幅」给足 1–3 页）。
          这里**不再**用固定 794×1123 的 iframe —— 那是"大图界面三个滚动条"的成因：
          弹窗窄于 794px 时出横向滚动条，文档比一页高时 iframe 内部再出一条竖向滚动条，
          加上弹窗本体那条，一共三条。缩放成自适应宽度后，整块只剩弹窗本体一条。 */}
      <Modal
        title={
          zoomTemplate
            ? t("gallery.zoom.titleWithName", { name: zoomTemplate.label })
            : t("gallery.zoom.title")
        }
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
              {zoomTemplate.name === selectedName
                ? t("gallery.status.current")
                : t("gallery.action.use")}
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
            title={t("gallery.zoom.frameTitle")}
            fit="width"
            pages={zoomPages}
          />
        )}
      </Modal>
    </Modal>
  );
}
