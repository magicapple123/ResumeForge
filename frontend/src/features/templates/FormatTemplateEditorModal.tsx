// SPDX-License-Identifier: Apache-2.0
/**
 * 版式编辑器：调行高、页边距、强调色这类排版参数。
 *
 * 与模板分开是有意的：用户想"压到一页"时不该去改 CSS。这里每个参数都有范围，
 * 越界值后端会直接丢弃，所以界面上也用 InputNumber 限死，不让用户白改一次。
 *
 * ## 版面：按 `group` 分区 + 两列栅格（I-19）
 *
 * 15 个参数**单列**排下来约 1570px，而控件只有 90px 宽、右侧 400px 全空；14 条参数
 * 说明逐条挂在控件下方，把表单撑成了一篇说明书。现在：
 *
 * - 分区依据是后端下发的 `group`（定义在 `services/resume/resume_format_groups.py`），
 *   分区顺序 = 字段在目录里**首次出现**的顺序（前端不另存一份组顺序，否则会与后端的
 *   字段顺序漂成两套）；未登记的字段落到"无组头"的收尾区，照常渲染而不是被藏起来；
 * - 栅格 `1fr 1fr`：同一行的两个字段顶边对齐，窄屏（<640px）退成一列；
 * - 每条的 `description` 收进 `ⓘ`（`HintDetail`），逐字用后端原文，不在前端改写；
 * - 颜色行 = 26×22 色块 + 11px 等宽 hex；没设过时色块打斜纹、文字写「跟随模板」。
 *
 * ## `requires`：模板不支持时置灰
 *
 * `header_rule_gap` 只对**带页眉线**的模板有意义。目录里每套模板的
 * `header_border_width` 是这条判断的唯一来源（`template_layouts`）。版式预设本身不绑定
 * 模板（它会被套到任意模板的简历上），所以这里只有在**目录里没有任何一套模板带页眉线**
 * 时才禁用；具体到某一份简历的精确置灰在 `ResumeSpacingControls`（那里 `layout.template`
 * 是已知的）。目录不下发 `template_layouts` 时不禁用——宁可让控件可用，也不要在旧后端
 * 上把参数锁死却说不清原因。
 */
import { App, Button, Form, Input, InputNumber, Typography } from "antd";
import { Fragment, useState } from "react";
import HintDetail from "../../components/common/HintDetail";
import FormModal from "../../components/common/FormModal";
import { createResumeTemplate, updateResumeTemplate } from "../../api/resumeTemplates";
import { t } from "../../i18n";
import type { Locale } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeFormatConfig, ResumeFormatField, ResumeTemplateDetail } from "../../types";
import {
  formatFieldDescription,
  formatFieldGroup,
  formatFieldLabel,
} from "../../utils/resumeFormatLabels";

interface Props {
  open: boolean;
  /** 可调参数清单与内置预设由 /api/resumes/templates 下发。 */
  fields: ResumeFormatField[];
  template?: ResumeTemplateDetail | null;
  /**
   * 目录里每套模板的版式默认值。只读 `header_border_width`：`requires: "header_border"`
   * 的参数要靠它判断"这个模板到底有没有页眉线"。缺省（旧目录）时不禁用任何参数。
   */
  templateLayouts?: Record<string, { header_border_width?: number }>;
  onClose: () => void;
  onSaved: () => void;
}

type ConfigValue = string | number | string[] | null;

/** 颜色项没设过值时喂给 `<input type="color">` 的兜底（经典模板的强调色）。 */
const DEFAULT_COLOR = "#16365c";

/**
 * 用来认出"照片分区"的稳定键（该组的组级说明只挂在它所在的分区上）。
 *
 * 为什么按字段键认组而不是按中文组名：组名是展示文字，英文界面下它是 `Photo`，
 * 拿中文串去比会在英文界面里静默失配；字段键是协议值，中英一致。
 */
const PHOTO_GROUP_MARKER_KEY = "photo_radius";

/** 一个编辑器分区：`key` 既是分区键也是组头正名；空串 = 未登记分组（不带组头）。 */
export interface FormatFieldGroup {
  key: string;
  fields: ResumeFormatField[];
}

/**
 * 按 `field.group` 把字段切成若干段，顺序 = 字段**首次出现**的顺序。
 *
 * 无分组的字段（`group` 缺失或空串，例如旧后端）被统一收到最后一段、`key` 为空串，
 * 由调用方决定"不带组头"地照常渲染——**不丢字段**是这里唯一的硬约束。
 *
 * 导出是为了让单测能直接钉住"分区顺序 = 首次出现顺序"与"未登记字段在收尾区"，
 * 而不必去读渲染出来的 DOM 结构。
 */
export function groupFormatFields(fields: readonly ResumeFormatField[]): FormatFieldGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ResumeFormatField[]>();
  fields.forEach((field) => {
    const key = (field.group ?? "").trim();
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(field);
      return;
    }
    buckets.set(key, [field]);
    order.push(key);
  });
  const groups: FormatFieldGroup[] = [];
  order
    .filter((key) => key !== "")
    .forEach((key) => groups.push({ key, fields: buckets.get(key) ?? [] }));
  const ungrouped = buckets.get("");
  if (ungrouped) groups.push({ key: "", fields: ungrouped });
  return groups;
}

export default function FormatTemplateEditorModal({
  open,
  fields,
  template,
  templateLayouts,
  onClose,
  onSaved,
}: Props) {
  const locale: Locale = useLocale();
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, ConfigValue>>({});
  const [saving, setSaving] = useState(false);

  // 打开时回填模板内容。Compiler 规范：随 open/template 变化的回填用渲染期守卫。
  const [prevSync, setPrevSync] = useState<{
    open: boolean;
    template: ResumeTemplateDetail | null | undefined;
  } | null>(null);
  if (prevSync === null || prevSync.open !== open || prevSync.template !== template) {
    setPrevSync({ open, template });
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setValues({ ...((template?.config ?? {}) as ResumeFormatConfig) });
    }
  }

  const setValue = (key: string, value: ConfigValue) =>
    setValues((current) => ({ ...current, [key]: value }));

  /**
   * 目录里是否存在**任何**一套带页眉线的模板。
   *
   * `template_layouts` 缺失（旧目录）时返回 `true`：不禁用。版式预设不绑定具体模板，
   * 所以"全部模板都没有页眉线"才是真的无处可用；只要还有一套带线，这个参数就仍然值得调。
   */
  const layouts = Object.values(templateLayouts ?? {});
  const headerRuleAvailable =
    layouts.length === 0 || layouts.some((layout) => Number(layout?.header_border_width ?? 0) > 0);

  const save = async () => {
    if (!name.trim()) {
      message.warning(t("templatesUi.formatEditor.toast.needName"));
      return;
    }
    // 只提交填过的项：空值代表"沿用模板的设置"。
    const config: ResumeFormatConfig = {};
    Object.entries(values).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") config[key] = value;
    });
    if (Object.keys(config).length === 0) {
      message.warning(t("templatesUi.formatEditor.toast.needValue"));
      return;
    }
    setSaving(true);
    try {
      if (template) {
        await updateResumeTemplate(template.id, { name, description, config });
        message.success(t("templatesUi.formatEditor.toast.updated"));
      } else {
        await createResumeTemplate({ name, description, config, kind: "format" });
        message.success(t("templatesUi.formatEditor.toast.created"));
      }
      onSaved();
      onClose();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("templatesUi.formatEditor.error.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  /** 颜色行：斜纹色块（未设）/ 实心色块（已设）+ hex 或「跟随模板」+ 已设时的 ↺。 */
  const renderColor = (field: ResumeFormatField, label: string, disabled: boolean) => {
    const raw = values[field.key];
    const hex = typeof raw === "string" && raw.trim() !== "" ? raw : null;
    return (
      <span className="rf-format-color">
        <span className="rf-format-swatch-wrap">
          <input
            type="color"
            className="rf-format-color-input"
            aria-label={label}
            value={hex ?? DEFAULT_COLOR}
            disabled={disabled}
            onChange={(event) => setValue(field.key, event.target.value)}
          />
          <span
            aria-hidden="true"
            className={hex ? "rf-format-swatch" : "rf-format-swatch is-unset"}
            style={hex ? { background: hex } : undefined}
          />
        </span>
        {hex ? (
          <>
            <span className="rf-format-hex">{hex}</span>
            <Button
              type="text"
              size="small"
              className="rf-format-reset"
              aria-label={t("templatesUi.formatEditor.action.followTemplate", { name: label })}
              onClick={() => setValue(field.key, null)}
            >
              ↺
            </Button>
          </>
        ) : (
          <span className="rf-format-follow">{t("templatesUi.formatEditor.value.unset")}</span>
        )}
      </span>
    );
  };

  /** 数值行：定宽 96px；没设过时占位符写「跟随模板」而不是留一个空框。 */
  const renderNumber = (field: ResumeFormatField, label: string, disabled: boolean) => (
    <InputNumber
      className="rf-format-number"
      size="small"
      aria-label={label}
      value={typeof values[field.key] === "number" ? (values[field.key] as number) : null}
      min={field.min}
      max={field.max}
      step={field.step ?? 0.1}
      placeholder={t("templatesUi.formatEditor.value.unset")}
      disabled={disabled}
      onChange={(value) => setValue(field.key, value ?? null)}
    />
  );

  const renderField = (field: ResumeFormatField) => {
    const label = formatFieldLabel(field, locale, field.key);
    const detail = formatFieldDescription(field, locale);
    const disabled = field.requires === "header_border" && !headerRuleAvailable;
    return (
      <div key={field.key} className={disabled ? "rf-format-field is-disabled" : "rf-format-field"}>
        {/* 标签与控件同一行、控件靠右：一行 28px 高。若改成"标签在上、控件在下"，
            15 个参数会多出 15 行（约 300px），弹窗立刻超出 820px 的高度预算。 */}
        <div className="rf-format-field-head">
          <span className="rf-format-field-label">{label}</span>
          <HintDetail
            detail={detail}
            label={t("templatesUi.formatEditor.hint.fieldDetail", { name: label })}
          />
          <span className="rf-format-control">
            {field.type === "color"
              ? renderColor(field, label, disabled)
              : renderNumber(field, label, disabled)}
          </span>
        </div>
        {disabled ? (
          <span className="rf-format-field-note">
            {t("templatesUi.formatEditor.hint.noHeaderRule")}
          </span>
        ) : null}
      </div>
    );
  };

  const groups = groupFormatFields(fields);

  return (
    <FormModal
      title={
        template
          ? t("templatesUi.formatEditor.title.edit")
          : t("templatesUi.formatEditor.title.create")
      }
      open={open}
      onCancel={onClose}
      onSubmit={() => void save()}
      okText={t("templatesUi.formatEditor.action.save")}
      submitting={saving}
      width={620}
    >
      <Form layout="vertical" component={false}>
        <div className="rf-format-grid">
          {/* 名称与说明跨两列：它们是这份预设的身份，和参数不是同一栅格里的同类。 */}
          <div className="rf-format-span rf-format-meta">
            <span className="rf-format-field-label">
              {t("templatesUi.formatEditor.field.name")}
            </span>
            <Input
              value={name}
              maxLength={40}
              aria-label={t("templatesUi.formatEditor.field.name")}
              placeholder={t("templatesUi.formatEditor.placeholder.name")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="rf-format-span rf-format-meta">
            <span className="rf-format-field-label">
              {t("templatesUi.formatEditor.field.description")}
            </span>
            <Input
              value={description}
              maxLength={255}
              aria-label={t("templatesUi.formatEditor.field.description")}
              placeholder={t("templatesUi.formatEditor.placeholder.description")}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {groups.map((group) => {
            // 组头文字取该组**第一个字段**的 group / group_en（同组里两者必然一致：
            // 后端由 `GROUP_LABELS` 一处产出）。空 key = 未登记分组，不输出组头。
            const head = group.key ? formatFieldGroup(group.fields[0], locale) : "";
            const showPhotoNote = group.fields.some(
              (field) => field.key === PHOTO_GROUP_MARKER_KEY,
            );
            return (
              <Fragment key={group.key || "__ungrouped__"}>
                {head ? (
                  <div className="rf-format-group rf-format-span">
                    <span className="rf-format-group-name">{head}</span>
                    {showPhotoNote ? (
                      <span className="rf-format-group-note">
                        {t("templatesUi.formatEditor.groupNote.photo")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {group.fields.map(renderField)}
              </Fragment>
            );
          })}
        </div>
      </Form>
      <Typography.Text type="secondary" className="rf-format-footnote">
        {t("templatesUi.formatEditor.hint.blank")}
      </Typography.Text>
    </FormModal>
  );
}
