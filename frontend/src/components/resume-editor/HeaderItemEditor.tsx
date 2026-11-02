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
import { CameraOutlined, DeleteOutlined, ScissorOutlined } from "@ant-design/icons";
import Button from "antd/es/button";
import Input from "antd/es/input";
import Select from "antd/es/select";
import Space from "antd/es/space";
import Upload from "antd/es/upload";
import { useState } from "react";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import type { HeaderItem, HeaderPlacement, ResumeDocument } from "../../types/resumeDocument";
import {
  CUSTOM_HEADER_KEY_PREFIX,
  HEADER_PLACEMENT_LABEL_KEYS,
  HEADER_PLACEMENT_ORDER,
  isCustomHeaderItem,
  isPhotoDataUrl,
} from "../../features/resume-document/headerOrder";
import { removeHeaderItem, updateHeaderItem } from "../../features/resume-document/mutations";
import {
  type PhotoCropParams,
  readPhotoCropFromFormatConfig,
  withPhotoCrop,
} from "../../features/resume-proview/photoCrop";
import { readAsDataUrl } from "../../utils/attachments";
import CroppedPhotoThumb from "./CroppedPhotoThumb";
import PhotoCropDialog from "./PhotoCropDialog";
import ResizableValueTextArea from "./ResizableValueTextArea";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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
  const [cropOpen, setCropOpen] = useState(false);
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

  const uploadPhoto = (file: File) => {
    if (!PHOTO_TYPES.has(file.type)) {
      onNotice(t("document.photo.formatError"), "warning");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      onNotice(t("document.photo.tooLarge"), "warning");
      return;
    }
    void readAsDataUrl(file)
      .then((dataUrl) => {
        clearCrop();
        patch({ value: dataUrl });
        onNotice(t("document.photo.updated"), "info");
      })
      .catch(() => onNotice(t("document.photo.readFailed"), "warning"));
  };

  /**
   * 打开裁剪：弹窗自己按**已保存参数**还原矩形（没有参数就是整幅），
   * 这里不再持有一份 draft，避免"两套状态各说各话"。
   */
  const openCrop = () => {
    setCropOpen(true);
  };

  /** `params = null` = 恢复原图（删掉 `photo_crop` 域）。 */
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
        <div className="document-photo-editor">
          <div className="document-photo-frame">
            {photo ? (
              <CroppedPhotoThumb
                photo={photo}
                crop={cropParams}
                className="document-photo-thumb"
                alt={t("document.photo.thumbnail")}
              />
            ) : (
              <span className="document-photo-empty">{t("document.photo.empty")}</span>
            )}
          </div>
          <Space wrap>
            <Upload
              accept="image/jpeg,image/png,image/webp"
              showUploadList={false}
              disabled={readOnly}
              beforeUpload={(file) => {
                uploadPhoto(file as File);
                return Upload.LIST_IGNORE;
              }}
            >
              <Button size="small" icon={<CameraOutlined />} disabled={readOnly}>
                {t("document.photo.replace")}
              </Button>
            </Upload>
            <Button
              size="small"
              icon={<ScissorOutlined />}
              disabled={readOnly || !photo}
              onClick={openCrop}
            >
              {t("document.photo.crop")}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={readOnly || !photo}
              onClick={() => {
                clearCrop();
                patch({ value: "" });
                onNotice(t("document.photo.removed"), "info");
              }}
            >
              {t("document.photo.remove")}
            </Button>
          </Space>
        </div>
        <PlacementSelect
          value={item.placement}
          disabled={readOnly}
          onChange={(placement) => patch({ placement })}
        />
        <PhotoCropDialog
          open={cropOpen}
          photo={photo}
          initialCrop={cropParams}
          onClose={() => setCropOpen(false)}
          onApply={applyCrop}
          onNotice={onNotice}
        />
      </div>
    );
  }

  return (
    <div className="document-item-editor document-header-editor" data-document-path={path}>
      {isCustomHeaderItem(item) ? (
        <Input
          size="small"
          aria-label={t("document.basic.customField")}
          placeholder={t("document.basic.customField")}
          value={item.label}
          disabled={readOnly}
          onChange={(event) => patch({ label: event.target.value })}
        />
      ) : null}
      {/* 值输入：问题 8 起改成"单行语义、可拖高"的文本域（自定义标签那颗 Input 保持不动）。 */}
      <ResizableValueTextArea
        ariaLabel={label}
        placeholder={t("document.field.valuePlaceholder")}
        value={item.value}
        disabled={readOnly}
        onChange={(value) => patch({ value })}
      />
      <PlacementSelect
        value={item.placement}
        disabled={readOnly}
        onChange={(placement) => patch({ placement })}
      />
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
