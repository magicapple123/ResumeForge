// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式控件 · 第一组：**结构类**（模板 / 版式 / 最大篇幅）。
 *
 * 2026-10-30（T7）：v1 的「板块顺序」Popover 已删除——v2 的分区顺序就是 document.sections
 * 本身（planner 按它出计划），由结构页签拖拽排序；converter 只在旧数据迁移时读
 * format_config.section_order。
 *
 * 从 `ResumeLayoutControls` 拆出（P2 / D4）：主控件当时已 495 行贴预算；"结构"与"度量"
 * 正好是工具栏两个插槽的天然边界；生成配置阶段仍要"一行全都要"，所以壳 + 两组零重复。
 * 本组只管**结构**（长什么样、板块怎么排、最多几页）；字号/行距/页边距在
 * `ResumeMeasureControls`，两者共用壳里取到的那一份模板目录。
 */
import { PictureOutlined } from "@ant-design/icons";
import { Button, Segmented, Select, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { RESUME_PAGE_LIMITS, UNLIMITED_PAGE_LIMIT } from "../../../types";
import type { ResumeFormatPreset, ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import { useI18n } from "../../../i18n/i18nContext";
import { pageLimitOptionLabel } from "../../../i18n/countMessage";
import {
  RESUME_CATALOG_FORMAT_DESCRIPTION_KEYS,
  resumeTemplateDescription,
  resumeTemplateLabel,
} from "../../../i18n/enum/resumeCatalog";
import { layoutWithFormatPreset } from "./layoutWithFormatPreset";
import HintDetail from "../../../components/common/HintDetail";
import { formatPresetLabelOf } from "./resumeTemplatePresetLabel";
import ResumeLanguageSelect from "./ResumeLanguageSelect";
import TemplateGalleryModal from "../template-trial/TemplateGalleryModal";

interface Props {
  layout: ResumeLayout;
  disabled?: boolean;
  /** 紧凑模式：只留控件、不显示分组标签（放在工具栏里时用）。 */
  compact?: boolean;
  /** 模板目录（由壳 `ResumeLayoutControls` 取一次后下发，避免两组各拉一次）。 */
  catalog?: ResumeTemplateCatalog;
  /** 岗位广场的生成配置只让用户定 5 个参数，版式预设留到简历界面再调。缺省都渲染。 */
  showFormat?: boolean;
  /** 最大篇幅控件：缺省渲染；制作台把它收进「版面」组（同一键只保留一处），传 false。 */
  showPageLimit?: boolean;
  /** 字段语言控件：缺省渲染；制作台把它移到「版面」组（同一键只保留一处），传 false。 */
  showLanguage?: boolean;
  /**
   * W10 模板图库的试用能力（都可选；不传 = 试用只能看示例，行为与之前逐字相同）：
   * - `resumeId`：启用「我的内容 + 真实页数/溢出」；
   * - `content`：有未保存草稿时按它预览/测量（不落库）；
   * - `onTrialAdopt`：传了才可清空覆盖；不传时采纳退回 `onSelect(template)`。
   */
  resumeId?: number | null;
  /**
   * 未保存的当前正文（v2 文档）：试用"我的内容"按它预览与测量。
   * 与宿主同一份 `ResumeDocument`——v1 形状的 `ResumeContent` 在 v2 工作台里已经不存在。
   */
  content?: ResumeDocument | null;
  onTrialAdopt?: (request: { template: string; formatConfig: ResumeFormatConfig }) => void;
  /** 页数选项：缺省用内置 `RESUME_PAGE_LIMITS`（1–3 页）；生成配置的长 CV 模式传 1–10。 */
  pageLimitOptions?: readonly number[];
  onChange: (layout: ResumeLayout) => void;
}

/**
 * 版式预设切换的纯计算住在 `layoutWithFormatPreset.ts`：组件文件只导出组件，
 * 这样热更新才是"只换这一个"（`react-refresh/only-export-components`）。
 */
export default function ResumeTemplateControls({
  layout,
  disabled = false,
  compact = false,
  showFormat = true,
  showPageLimit = true,
  showLanguage = true,
  catalog,
  resumeId,
  content,
  onTrialAdopt,
  pageLimitOptions,
  onChange,
}: Props) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  // 版式下拉是点击触发的：选定后提示就该收掉，而不是等鼠标移开（受控开关）。
  // 注意下拉选项在 portal 里渲染，点击不会冒泡到触发器，所以 onChange 里也要关。
  const [formatTipOpen, setFormatTipOpen] = useState(false);
  const { t } = useI18n();
  const templates = catalog?.templates ?? [];
  const formatPresets = catalog?.format_presets ?? [];
  /**
   * 版式预设的展示名：内置预设按稳定 `name` 映射到语言包；自制版式的名字是用户输入，
   * 后端新增的未知预设也映射不到——两者一律回退后端原文（不丢信息）。
   */
  const formatPresetLabel = (item: ResumeFormatPreset): string => formatPresetLabelOf(item, t);

  const currentTemplate = templates.find((item) => item.name === layout.template);

  return (
    // 分组间距与壳的间距一致（compact 8 / 非 compact 16），所以拆开之后每个分组之间的
    // 节奏与拆分前完全相同。`wrap` 保留拆分前"分组可以各自换行"的行为。
    // 类名供宿主做行内分配：生成配置阶段让「最大篇幅」单独靠右（见 modules.css），
    // 预览工具栏里这些类名不匹配任何规则，形态不变。
    <Space size={compact ? 8 : 16} wrap className="resume-template-controls">
      <Space size={6}>
        {!compact && (
          <Typography.Text type="secondary">
            {t("sections.templateControls.templateLabel")}
          </Typography.Text>
        )}
        {/* 选模板与看效果合并成同一个入口：打开的就是"每种模板的真实渲染"，
            点「用这个模板」即写入并重渲染（没有额外确认步骤）。这样就不必先在下拉里
            按名字盲选、再另外点一次「看效果」——选与看是同一件事。 */}
        <Tooltip
          title={
            currentTemplate
              ? t("sections.templateControls.templateTooltipWithDescription", {
                  description: resumeTemplateDescription(currentTemplate),
                })
              : t("sections.templateControls.templateTooltip")
          }
        >
          <Button
            size="small"
            icon={<PictureOutlined />}
            disabled={disabled || templates.length === 0}
            aria-label={t("sections.templateControls.templateAriaLabel")}
            onClick={() => setGalleryOpen(true)}
          >
            {currentTemplate ? resumeTemplateLabel(currentTemplate) : layout.template}
            {currentTemplate?.custom ? t("sections.templateControls.customSuffix") : ""}
          </Button>
        </Tooltip>
      </Space>
      {showFormat && (
        <Space size={6}>
          {!compact && (
            <Typography.Text type="secondary">
              {t("sections.templateControls.formatLabel")}
            </Typography.Text>
          )}
          <Tooltip
            open={formatTipOpen}
            onOpenChange={setFormatTipOpen}
            title={t("sections.templateControls.formatHint")}
          >
            <span onClick={() => setFormatTipOpen(false)}>
              <Select
                size="small"
                value={layout.format_name || ""}
                disabled={disabled}
                // 下拉只有一行可见文字时，读屏软件读到的仍是"combobox"——补一个与视觉标签
                // 同名的无障碍名（工具栏里现在有两个下拉，按名字定位也才稳）。
                aria-label={t("resume.format.label")}
                // I-06：触发框现在跟着左栏控件列伸缩（104 → 封顶 320）。弹层跟着触发框
                // 一起变宽，所以不再关掉 `popupMatchSelectWidth`——关掉时弹层按内容宽算，
                // 宽栏里会变成"框 320、层 130"，点开像跳出来一小块。
                className="resume-format-select"
                // 弹层宽度：字体下拉与版式下拉共用 `.resume-params-dropdown`（216px，字体是
                // 竖排两层，需要那个宽度），版式下拉再由 `.resume-format-dropdown` 收窄到
                // 6 个中文字符宽（见 resume-workbench-controls.css）。触发框宽度不受影响
                // （仍由 `.resume-format-select` 管）。两个类都要带上：只写专属类会丢掉共用的
                // `max-width` 兜底与选项单行省略规则。
                classNames={{ popup: { root: "resume-params-dropdown resume-format-dropdown" } }}
                options={[
                  { value: "", label: t("sections.templateControls.followTemplate") },
                  ...formatPresets.map((item) => {
                    // 展示名与说明都走语言包；自制版式的名字与说明是用户数据，原样显示。
                    const label = formatPresetLabel(item);
                    const descriptionKey = RESUME_CATALOG_FORMAT_DESCRIPTION_KEYS[item.name];
                    return {
                      value: item.name,
                      label: item.custom
                        ? `${label}${t("sections.templateControls.customSuffix")}`
                        : label,
                      title: item.custom || !descriptionKey ? item.description : t(descriptionKey),
                    };
                  }),
                ]}
                // 弹层定宽 + 单行省略之后，"这个名字到底叫什么"只能靠悬停：
                // 这里包一层带 `title` 的 span（选项自己的 `title` 是**说明**，不是名字，
                // 名字被截断时指上去看到的会是"行高 1.45、页边距 12mm…"，答非所问）。
                optionRender={(option) => (
                  <span
                    className="resume-format-option"
                    title={typeof option.data.label === "string" ? option.data.label : undefined}
                  >
                    {option.data.label}
                  </span>
                )}
                onChange={(value) => {
                  setFormatTipOpen(false);
                  onChange(layoutWithFormatPreset(layout, value, formatPresets));
                }}
              />
            </span>
          </Tooltip>
        </Space>
      )}
      <TemplateGalleryModal
        open={galleryOpen}
        layout={layout}
        // 字号档位写回这份简历：所有者（预览 / 制作台 / 生成配置）负责重排，
        // 于是"在模板界面选字号"与"看到新字号"是同一次动作。
        onFontScaleChange={(font_scale) => onChange({ ...layout, font_scale })}
        onSelect={(template) => onChange({ ...layout, template })}
        resumeId={resumeId}
        content={content}
        onTrialAdopt={onTrialAdopt}
        onClose={() => setGalleryOpen(false)}
      />
      {/* 简历语言：与页数/字号同属"排出来长什么样"。I-17：40 字的「只改小节标题与字段名、
          不翻译正文」从包住整个下拉的 tooltip 改成右侧的 `ⓘ`——它要能主动点开读完，
          而不是"鼠标挪开就没了"。`undefined` = 这次不涉及，界面显示中文。
          #13：制作台把它移进「版面」组（showLanguage={false}），模板组只留模板与版式。 */}
      {showLanguage && (
        <Space size={6}>
          {!compact && (
            <Typography.Text type="secondary">{t("resume.language.label")}</Typography.Text>
          )}
          <ResumeLanguageSelect
            value={layout.language ?? "zh-CN"}
            disabled={disabled}
            onChange={(language) => onChange({ ...layout, language })}
          />
          <HintDetail detail={t("resume.language.hint")} label={t("resume.language.hintAria")} />
        </Space>
      )}

      {showPageLimit && (
        <Space size={6} className="resume-page-limit-group">
          {!compact && (
            <Typography.Text type="secondary">
              {t("sections.templateControls.pageLimitLabel")}
            </Typography.Text>
          )}
          <Tooltip title={t("sections.templateControls.pageLimitHint")}>
            <Segmented
              size="small"
              value={layout.page_limit}
              disabled={disabled}
              options={(pageLimitOptions ?? RESUME_PAGE_LIMITS).map((value) => ({
                value,
                // 需求 7B：0 = 不限篇幅，必须单独一条文案（否则会渲染成「0 页」）。
                label:
                  value === UNLIMITED_PAGE_LIMIT
                    ? t("sections.templateControls.pageLimitUnlimited")
                    : pageLimitOptionLabel(value),
              }))}
              onChange={(value) => onChange({ ...layout, page_limit: value as number })}
            />
          </Tooltip>
        </Space>
      )}
    </Space>
  );
}
