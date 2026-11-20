// SPDX-License-Identifier: Apache-2.0
/**
 * 页眉字段的展开态编辑器（#10 / #25 / 任务 6）。
 *
 * 普通字段与正文的 `ItemEditor` 保持同一套动作：改值、改位置、删除。照片字段单独一套：
 * **缩略图 + 更换 / 裁剪 / 移除**，值仍是页眉 item 的 data URL（不引入第二份真相）。
 *
 * ## 任务 6：裁剪改成非破坏
 *
 * 裁剪结果不再回写 `item.value`（那会让第二次裁剪的输入是上一次的输出，取景大小永远回不到
 * 最初），而是写进 `format_config.photo_crop`——与预览页那张裁剪弹窗、与后端
 * `resume_photo_crop` 的冻结契约同一份数据。原图因此一个字节都不动，「恢复原图」= 删掉
 * 这个域。**换照片 / 移除照片时必须同步清掉它**：`source.sha256` 指向旧图，留着就是死数据
 * （后端会判失效、保存时再由 `prune_overrides` 裁掉，但界面会短暂地"裁剪还在"）。
 */
import { DeleteOutlined } from "@ant-design/icons";
import Button from "antd/es/button";
import Input from "antd/es/input";
import Select from "antd/es/select";
import Tooltip from "antd/es/tooltip";
import type { MessageKey } from "../../../i18n";
import { useI18n } from "../../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import type {
  HeaderItem,
  HeaderPlacement,
  LabelMode,
  ResumeDocument,
} from "../../../types/resumeDocument";
import {
  CUSTOM_HEADER_KEY_PREFIX,
  HEADER_PLACEMENT_LABEL_KEYS,
  HEADER_PLACEMENT_ORDER,
  isCustomHeaderItem,
  isPhotoDataUrl,
} from "../document/headerOrder";
import { removeHeaderItem, updateHeaderItem } from "../document/mutations";
import {
  type PhotoCropParams,
  readPhotoCropFromFormatConfig,
  withPhotoCrop,
} from "../preview/photoCrop";
import PhotoAssetEditor from "./PhotoAssetEditor";
import AutoGrowValueTextArea from "./AutoGrowValueTextArea";
import { applyInlineEdit } from "./lastFocusedTextarea";
import { readRichValue, richItemPatch } from "./inlineMarkWrite";
import { registerInlineMarkField } from "./useInlineMarkRange";
import InlineMarkContextMenu from "../layout/InlineMarkContextMenu";

//: 字段名开关适用的位置：name / photo 不提供（F20）。
const LABEL_MODE_PLACEMENTS = new Set<HeaderPlacement>(["contact", "subtitle", "name_meta"]);

interface Props {
  document: ResumeDocument;
  path: string;
  item: HeaderItem;
  label: string;
  readOnly?: boolean;
  /** 当前版式的 `format_config`（裁剪参数住在它的 `photo_crop` 域里）。 */
  formatConfig?: ResumeFormatConfig | null;
  /** 写回 `format_config` 的唯一通道（宿主把它并进 layout）。 */
  onFormatConfigChange?: (next: ResumeFormatConfig) => void;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function HeaderItemEditor({
  document,
  path,
  item,
  label,
  readOnly = false,
  formatConfig = null,
  onFormatConfigChange,
  onChange,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const isPhoto = item.key === "photo";
  const photo = isPhotoDataUrl(item.value) ? item.value : "";
  const cropParams: PhotoCropParams | null = isPhoto
    ? readPhotoCropFromFormatConfig(formatConfig)
    : null;

  const patch = (next: Partial<HeaderItem>) => onChange(updateHeaderItem(document, path, next));

  /** 换图 / 移图后旧裁剪切区域必然失效（sha 指向旧图），一起清掉。 */
  const clearCrop = () => {
    if (!onFormatConfigChange || !cropParams) return;
    onFormatConfigChange(withPhotoCrop(formatConfig, null));
  };

  /** 裁剪参数写回：`null` = 恢复原图（删掉 `photo_crop` 域）。 */
  const applyCrop = (params: PhotoCropParams | null) => {
    if (!onFormatConfigChange) {
      onNotice(t("document.photo.cropFailed"), "warning");
      return;
    }
    onFormatConfigChange(withPhotoCrop(formatConfig, params));
    onNotice(params ? t("document.photo.cropped") : t("proview.photo.cleared"), "info");
  };

  if (isPhoto) {
    return (
      <div className="document-item-editor document-header-editor" data-document-path={path}>
        {/* T02：上传/裁剪/删除抽到 `PhotoAssetEditor`，与左栏「照片」页签共用一份实现。 */}
        <PhotoAssetEditor
          photo={photo}
          crop={cropParams}
          disabled={readOnly}
          variant="compact"
          onCropChange={onFormatConfigChange ? applyCrop : undefined}
          onPhotoChange={(dataUrl) => {
            clearCrop();
            patch({ value: dataUrl });
          }}
          onNotice={onNotice}
        />
        <PlacementSelect
          value={item.placement}
          disabled={readOnly}
          onChange={(placement) => patch({ placement })}
        />
      </div>
    );
  }

  /** F22：页眉字段的右键菜单与条目共用一套规则（页眉没有工具条，右键是这里的入口）。 */
  const inlineCommit = (next: { text: string; selection: { start: number; end: number } }) =>
    applyInlineEdit({ text: next.text, start: next.selection.start, end: next.selection.end });

  /**
   * I-13：值的**读写都走结构化模型**。
   *
   * 读：有 `rich` 用它，没有就把旧标记串解析成纯文本 + runs（兼容读，见 `readRichValue`）。
   * 写：`value` 恒为纯文本，样式落 `rich.runs`——标记串不再被拼出来。
   */
  const richValue = readRichValue(item);

  return (
    <InlineMarkContextMenu onCommit={inlineCommit} disabled={readOnly}>
      <div className="document-item-editor document-header-editor" data-document-path={path}>
        {isCustomHeaderItem(item) ? (
          <Input
            size="small"
            aria-label={t("document.basic.customField")}
            placeholder={t("document.basic.customField")}
            value={item.label}
            disabled={readOnly}
            onFocus={registerInlineMarkField}
            onChange={(event) => patch({ label: event.target.value })}
          />
        ) : null}
        {/* 值输入：问题 8 起是"单行语义"的文本域，I-14 起按内容自适应（1–4 行）；
            自定义标签那颗 Input 保持不动。 */}
        <AutoGrowValueTextArea
          ariaLabel={label}
          placeholder={t("document.field.valuePlaceholder")}
          value={richValue.text}
          rich={{ runs: richValue.runs, onChange: (next) => patch(richItemPatch(next)) }}
          disabled={readOnly}
          onChange={(value) => patch({ value })}
        />
        <PlacementSelect
          value={item.placement}
          disabled={readOnly}
          onChange={(placement) => patch({ placement })}
        />
        {LABEL_MODE_PLACEMENTS.has(item.placement) ? (
          // F20：三态改为「自动 / 显示字段名 / 隐藏字段名」。`auto` 是默认值，与存量行为
          // 逐字节一致；入口只有这一处（版面参数组不再另设总开关，避免两个真源）。
          <Tooltip title={t("structure.layout.labelMode.hint")}>
            <Select
              size="small"
              className="document-header-label-mode"
              aria-label={t("structure.layout.labelMode.aria")}
              disabled={readOnly || undefined}
              value={item.label_mode ?? (item.show_label === false ? "hide" : "auto")}
              options={[
                { value: "auto", label: t("structure.layout.labelMode.auto") },
                { value: "show", label: t("structure.layout.labelMode.show") },
                { value: "hide", label: t("structure.layout.labelMode.hide") },
              ]}
              onChange={(mode: LabelMode) => patch({ label_mode: mode })}
            />
          </Tooltip>
        ) : null}
        {!readOnly ? (
          <Button
            size="small"
            type="text"
            danger
            aria-label={t("document.item.remove")}
            icon={<DeleteOutlined />}
            onClick={() => {
              onChange(removeHeaderItem(document, path));
              onNotice(t("document.toast.fieldRemoved"), "info");
            }}
          />
        ) : null}
      </div>
    </InlineMarkContextMenu>
  );
}

function PlacementSelect({
  value,
  disabled,
  onChange,
}: {
  value: HeaderPlacement;
  disabled: boolean;
  onChange: (placement: HeaderPlacement) => void;
}) {
  const { t } = useI18n();
  const options = HEADER_PLACEMENT_ORDER.map((placement) => ({
    value: placement,
    label: t(HEADER_PLACEMENT_LABEL_KEYS[placement] as MessageKey),
  }));
  return (
    <Select
      size="small"
      aria-label={t("document.placement.aria")}
      value={value}
      disabled={disabled}
      options={options}
      onChange={(placement: HeaderPlacement) => onChange(placement)}
    />
  );
}

/** 自定义字段的 key 生成（与目录 key 不冲突；id 仍是页面内唯一）。 */
export function customHeaderKey(id: string): string {
  return `${CUSTOM_HEADER_KEY_PREFIX}${id}`;
}
