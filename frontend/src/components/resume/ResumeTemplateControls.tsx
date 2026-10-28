// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式控件 · 第一组：**结构类**（模板 / 版式 / 板块顺序 / 最大篇幅）。
 *
 * 从 `ResumeLayoutControls` 拆出（P2 / D4）。拆分的三条理由：
 * 1. 主控件已 495 行、贴着单文件预算，再加东西就越线；
 * 2. 项 4 要求第一行摆"模板/版式/顺序/页数"、第二行摆"字号/行距/页边距"——这正是天然的
 *    分组边界，也是本次拆分的**容器边界**（工具栏按这两个插槽分别渲染）；
 * 3. 生成配置阶段仍要"一行全都要"，所以壳必须存在——壳 + 两组同时满足两种形态，零重复。
 *
 * 本组只管**结构**（长什么样、板块怎么排、最多几页）。影响"排出来的字"的度量参数
 * （字号/行距/页边距）在 `ResumeMeasureControls`，两者共用壳里取到的那一份模板目录。
 */
import { ArrowDownOutlined, ArrowUpOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Popover, Segmented, Select, Space, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { RESUME_PAGE_LIMITS } from "../../types";
import type {
  ResumeContent,
  ResumeFormatPreset,
  ResumeLayout,
  ResumeTemplateCatalog,
} from "../../types";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { useI18n } from "../../i18n/i18nContext";
import {
  RESUME_CATALOG_FORMAT_DESCRIPTION_KEYS,
  RESUME_CATALOG_FORMAT_LABEL_KEYS,
  RESUME_CATALOG_SECTION_LABEL_KEYS,
} from "../../i18n/enum/resumeCatalog";
import { layoutWithFormatPreset } from "./layoutWithFormatPreset";
import {
  buildSectionOrderConfig,
  DEFAULT_RESUME_SECTION_ORDER,
  normalizeSectionOrder,
  RESUME_SECTION_LABELS,
} from "../../utils/resumeSectionOrder";
import ContactBreaksControl from "../../features/resume-layout/ContactBreaksControl";
import {
  customSectionRows as collectCustomSectionRows,
  moveVisibleSection,
  presentSectionKeys,
} from "../../features/resume-layout/sectionPresence";
import ResumeLanguageSelect from "./ResumeLanguageSelect";
import TemplateGalleryModal from "./TemplateGalleryModal";

interface Props {
  layout: ResumeLayout;
  disabled?: boolean;
  /** 紧凑模式：只留控件、不显示分组标签（放在工具栏里时用）。 */
  compact?: boolean;
  /** 模板目录（由壳 `ResumeLayoutControls` 取一次后下发，避免两组各拉一次）。 */
  catalog?: ResumeTemplateCatalog;
  /**
   * 默认板块顺序是否跟随「我的资料」。
   *
   * 只在**生成**场景为 true：新简历的默认顺序应当等于用户在资料页排好的顺序。
   * 已保存简历（预览 / 编辑）与生成后的预览阶段都不传——它们读的是这份简历自己的
   * `section_order`，没有则用内置默认。否则用户在资料页拖一下，所有老简历的外观都会
   * 跟着变，而"老简历不追溯改变"是这条功能的前提。
   */
  preferProfileOrder?: boolean;
  /**
   * W10 模板图库的试用能力（都可选；不传 = 试用只能看示例，行为与之前逐字相同）：
   * - `resumeId`：启用「我的内容 + 真实页数/溢出」；
   * - `content`：有未保存草稿时按它预览/测量（不落库）；
   * - `onTrialAdopt`：传了才可清空覆盖；不传时采纳退回 `onSelect(template)`。
   */
  resumeId?: number | null;
  content?: ResumeContent | null;
  onTrialAdopt?: (request: { template: string; formatConfig: ResumeFormatConfig }) => void;
  /**
   * 页数选项：缺省用内置 `RESUME_PAGE_LIMITS`（1–3 页）。
   * 生成配置的长 CV 模式传 1–10（契约 §5）；其他宿主不传，行为与此前逐字一致。
   */
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
  catalog,
  preferProfileOrder = false,
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
  const formatPresetLabel = (item: ResumeFormatPreset): string => {
    const labelKey = item.custom ? undefined : RESUME_CATALOG_FORMAT_LABEL_KEYS[item.name];
    return labelKey ? t(labelKey) : item.label;
  };

  const currentTemplate = templates.find((item) => item.name === layout.template);

  // 正文分区顺序：键与标签由后端下发（改默认值只改一处），归一化在前端做同样的事，
  // 因为控件展示的是"完整排列"，而存储里可能只有用户动过的那几项。
  const builtInSectionOrder = useMemo(
    () => catalog?.default_section_order ?? DEFAULT_RESUME_SECTION_ORDER,
    [catalog?.default_section_order],
  );
  // 生效的默认顺序：生成场景跟随资料页，其余场景用内置默认。两个字段刻意分开下发
  // （`profile_section_order` / `default_section_order`），这里按场景选一个。
  const defaultSectionOrder = useMemo(
    () =>
      preferProfileOrder
        ? (catalog?.profile_section_order ?? builtInSectionOrder)
        : builtInSectionOrder,
    [preferProfileOrder, catalog?.profile_section_order, builtInSectionOrder],
  );
  const sectionOptions = useMemo(() => catalog?.section_options ?? [], [catalog?.section_options]);
  const sectionOrder = useMemo(
    () => normalizeSectionOrder(layout.format_config?.section_order, defaultSectionOrder),
    [layout.format_config?.section_order, defaultSectionOrder],
  );
  // 当前简历里真的有内容的板块；内容为空时退回完整列表（空简历仍能看到默认顺序）。
  const presentKeys = useMemo(
    () => presentSectionKeys(content, sectionOptions),
    [content, sectionOptions],
  );
  const visibleSectionOrder = useMemo(
    () =>
      presentKeys && presentKeys.size > 0
        ? sectionOrder.filter((key) => presentKeys.has(key))
        : sectionOrder,
    [sectionOrder, presentKeys],
  );
  // 自建板块固定排在系统板块之后（渲染器口径），只列出有内容的，不给上下移。
  const customSectionRows = useMemo(() => collectCustomSectionRows(content), [content]);
  /**
   * 「顺序·已调整」的判据 = **`section_order` 这个键在不在**（P0-5），不是"和默认顺序比"。
   *
   * 两者只在"用户把顺序调成了恰好等于默认"时给出不同答案，而那时键还在存储里——它确实是
   * 被调过的（也解释了为什么"恢复默认"这个入口该出现）。更关键的是：键存在与否是**渲染器
   * 用的同一个判据**（`resolved_section_order`），显示与渲染从此看同一件事。
   */
  const isCustomOrder = "section_order" in (layout.format_config ?? {});

  /**
   * 在**可见列表**里上下移一格：只交换当前简历里有的那两个板块在完整 `section_order`
   * 里的位置，空板块的位置原样保留（它们不显示，但存储里仍是一份完整排列）。
   */
  const handleSectionMove = (key: string, direction: -1 | 1) => {
    const next = moveVisibleSection(sectionOrder, visibleSectionOrder, key, direction);
    if (!next) return;
    onChange({ ...layout, format_config: { ...layout.format_config, section_order: next } });
  };

  /**
   * 「按我的资料顺序排列」（P0-6）——**一次性快照**，不是一条持续的跟随。
   *
   * 语义：把资料页当前那套顺序写进**这份简历**的 `format_config.section_order`。写完就与资料
   * 脱钩：用户再去资料页拖动，这份简历不会跟着变（"老简历不追溯改变"是这条功能的前提）。
   * 与内置默认相同时 `buildSectionOrderConfig` 会删掉这个键——"调成和默认一样"与"没调过"
   * 在存储里是同一种形态。
   */
  const profileSectionOrder = useMemo(
    () => catalog?.profile_section_order ?? builtInSectionOrder,
    [catalog?.profile_section_order, builtInSectionOrder],
  );
  /**
   * 可用性的两个否决项（顺序即提示优先级：先说"根本没有可排序的分区"，再谈"顺序相同"）。
   *
   * 判 `profile_section_keys` 时**必须先滤掉 `basic_info`**：它是页眉（姓名 / 联系方式 /
   * 照片），不参与正文排序，而资料行几乎总是带着它——直接判数组是否为空会让这个分支永远
   * 不成立，用户点下去的按钮实际上什么都不会变。
   */
  const sortableProfileKeys = (catalog?.profile_section_keys ?? []).filter(
    (key) => key !== "basic_info",
  );
  const profileOrderSameAsDefault = profileSectionOrder.join(",") === builtInSectionOrder.join(",");
  const canArrangeByProfile = sortableProfileKeys.length > 0 && !profileOrderSameAsDefault;
  const arrangeByProfileHint =
    sortableProfileKeys.length === 0
      ? t("sections.profileOrderUnavailable")
      : profileOrderSameAsDefault
        ? t("sections.profileOrderSame")
        : t("sections.arrangeByProfileHint");

  const handleArrangeByProfile = () => {
    onChange({
      ...layout,
      format_config: buildSectionOrderConfig(
        profileSectionOrder,
        builtInSectionOrder,
        layout.format_config ?? {},
      ),
    });
  };

  const handleSectionOrderReset = () => {
    if (!isCustomOrder) return;
    // 「默认」在生成场景下就是资料顺序：写回它，用户才真的回到他看到的那一版；
    // 与内置默认相同时 helper 会把这个键删掉——"没调过"与"调成和默认一样"在存储里
    // 应当是同一种形态。非生成场景传内置默认，因此等于删除这个键（保持原行为）。
    onChange({
      ...layout,
      format_config: buildSectionOrderConfig(
        preferProfileOrder ? defaultSectionOrder : builtInSectionOrder,
        builtInSectionOrder,
        layout.format_config ?? {},
      ),
    });
  };

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
                  description: currentTemplate.description,
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
            {currentTemplate?.label ?? layout.template}
            {currentTemplate?.custom ? t("sections.templateControls.customSuffix") : ""}
          </Button>
        </Tooltip>
      </Space>
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
              // 宽度只够框住 4 个中文字符（见 `.resume-format-select`）：原来是 min-width:120，
              // 框比文字宽出一大截，和同一行的其它控件疏密不匀。名字更长的自制版式
              // （如「宽松（自制）」）在触发框里走省略号，展开后的列表按内容撑开。
              className="resume-format-select"
              popupMatchSelectWidth={false}
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
      <Space size={6}>
        {!compact && (
          <Typography.Text type="secondary">
            {t("sections.templateControls.sectionsLabel")}
          </Typography.Text>
        )}
        <Popover
          trigger="click"
          placement="bottomRight"
          arrow={false}
          title={
            <span className="resume-section-order-title">
              {t("sections.templateControls.orderTitle")}
              {/* 一次性快照：把资料页当前那套顺序写进这份简历（见 `handleArrangeByProfile`）。 */}
              <Tooltip title={arrangeByProfileHint}>
                {/* 包一层 span：禁用态的按钮不接收指针事件，Tooltip 只能挂在外层。 */}
                <span>
                  <Button
                    size="small"
                    type="link"
                    disabled={!canArrangeByProfile}
                    onClick={handleArrangeByProfile}
                  >
                    {t("sections.arrangeByProfile")}
                  </Button>
                </span>
              </Tooltip>
              {isCustomOrder && (
                <Button size="small" type="link" onClick={handleSectionOrderReset}>
                  {t("sections.templateControls.orderReset")}
                </Button>
              )}
            </span>
          }
          content={
            <div
              className="resume-section-order-list"
              role="list"
              aria-label={t("sections.templateControls.orderListAriaLabel")}
            >
              {visibleSectionOrder.map((key, index) => {
                // 后端下发的是中文展示名，先按稳定分区 key 映射到语言包；未知分区
                // （后端新增的）再回退目录原文，最后才是前端内置的七个兜底 key。
                const labelKey = RESUME_CATALOG_SECTION_LABEL_KEYS[key];
                const fallbackLabelKey = RESUME_SECTION_LABELS[key];
                const label =
                  (labelKey ? t(labelKey) : undefined) ??
                  sectionOptions.find((item) => item.key === key)?.label ??
                  (fallbackLabelKey ? t(fallbackLabelKey) : key);
                return (
                  <div className="resume-section-order-row" role="listitem" key={key}>
                    <span className="resume-section-order-index">{index + 1}</span>
                    <span className="resume-section-order-label">{label}</span>
                    <Space size={0}>
                      <Tooltip title={t("sections.templateControls.orderMoveUp")}>
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowUpOutlined />}
                          aria-label={t("sections.templateControls.orderMoveUpAria", { label })}
                          disabled={index === 0}
                          onClick={() => handleSectionMove(key, -1)}
                        />
                      </Tooltip>
                      <Tooltip title={t("sections.templateControls.orderMoveDown")}>
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowDownOutlined />}
                          aria-label={t("sections.templateControls.orderMoveDownAria", { label })}
                          disabled={index === visibleSectionOrder.length - 1}
                          onClick={() => handleSectionMove(key, 1)}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                );
              })}
              {customSectionRows.map((row, index) => (
                <div className="resume-section-order-row" role="listitem" key={row.key}>
                  <span className="resume-section-order-index">
                    {visibleSectionOrder.length + index + 1}
                  </span>
                  <span className="resume-section-order-label">{row.title}</span>
                  <Tooltip title={t("sections.templateControls.customFixedHint")}>
                    <Typography.Text type="secondary">
                      {t("sections.templateControls.customFixedTag")}
                    </Typography.Text>
                  </Tooltip>
                </div>
              ))}
              {visibleSectionOrder.length === 0 && customSectionRows.length === 0 ? (
                <Typography.Paragraph type="secondary">
                  {t("sections.templateControls.orderEmpty")}
                </Typography.Paragraph>
              ) : null}
              <Typography.Paragraph type="secondary" className="resume-section-order-hint">
                {t("sections.templateControls.orderHint")}
              </Typography.Paragraph>
            </div>
          }
        >
          <Tooltip title={t("sections.templateControls.orderTriggerHint")}>
            <Button
              size="small"
              disabled={disabled}
              aria-label={t("sections.templateControls.orderTriggerAriaLabel")}
            >
              {isCustomOrder
                ? t("sections.templateControls.orderTriggerAdjusted")
                : t("sections.templateControls.orderTrigger")}
            </Button>
          </Tooltip>
        </Popover>
      </Space>
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
              label: t("sections.templateControls.pageLimitPages", { count: value }),
            }))}
            onChange={(value) => onChange({ ...layout, page_limit: value as number })}
          />
        </Tooltip>
      </Space>
      {/* 联系方式换行（#3）：页眉那几个字段在哪断行。默认"字段整体不拆行、字段之间
          自动换行"，这里只是给用户一个显式控制点；参数随简历保存，四条渲染链路同源。 */}
      <ContactBreaksControl
        formatConfig={layout.format_config}
        disabled={disabled}
        compact={compact}
        onChange={(format_config) => onChange({ ...layout, format_config })}
      />
      {/* 简历语言：与页数/字号同属"排出来长什么样"，所以跟在结构组最后。
          提示**必须**用 Tooltip 而不是原生 title——原生 title 在触屏上永远不出现，
          而"只改小节标题与字段名、不翻译正文"正是最容易被误解的一句：
          用户选了 English 却发现正文还是中文，会以为功能坏了。
          `undefined` = 这次不涉及，界面上一律显示中文（后端旧记录也是中文）。 */}
      <Space size={6}>
        {!compact && (
          <Typography.Text type="secondary">{t("resume.language.label")}</Typography.Text>
        )}
        <Tooltip title={t("resume.language.hint")}>
          {/* 包一层 span：禁用态的下拉不接收指针事件，Tooltip 只能挂在外层。 */}
          <span>
            <ResumeLanguageSelect
              value={layout.language ?? "zh-CN"}
              disabled={disabled}
              onChange={(language) => onChange({ ...layout, language })}
            />
          </span>
        </Tooltip>
      </Space>
    </Space>
  );
}
