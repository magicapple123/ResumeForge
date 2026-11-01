// SPDX-License-Identifier: Apache-2.0
/**
 * 页眉字段的展开态编辑器（#10 / #25）。
 *
 * 普通字段与正文的 `ItemEditor` 保持同一套动作：改值、改位置、删除。照片字段单独一套：
 * **缩略图 + 更换 / 裁剪 / 移除**——此前制作台完全没有裁剪入口（#25 的缺口），
 * 这里把三个动作补齐，值仍是页眉 item 的 data URL（不引入第二份真相）。
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
import type { HeaderItem, HeaderPlacement, ResumeDocument } from "../../types/resumeDocument";
import {
  CUSTOM_HEADER_KEY_PREFIX,
  HEADER_PLACEMENT_LABEL_KEYS,
  HEADER_PLACEMENT_ORDER,
  isCustomHeaderItem,
  isPhotoDataUrl,
} from "../../features/resume-document/headerOrder";
import { removeHeaderItem, updateHeaderItem } from "../../features/resume-document/mutations";
import { DEFAULT_CROP_DRAFT, type PhotoCropDraft } from "../../features/resume-proview/photoCrop";
import { readAsDataUrl } from "../../utils/attachments";
import PhotoCropDialog from "./PhotoCropDialog";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  document: ResumeDocument;
  path: string;
  item: HeaderItem;
  label: string;
  readOnly?: boolean;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function HeaderItemEditor({
  document,
  path,
  item,
  label,
  readOnly = false,
  onChange,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const [cropOpen, setCropOpen] = useState(false);
  const [draft, setDraft] = useState<PhotoCropDraft>(DEFAULT_CROP_DRAFT);
  const isPhoto = item.key === "photo";
  const photo = isPhotoDataUrl(item.value) ? item.value : "";

  const patch = (next: Partial<HeaderItem>) => onChange(updateHeaderItem(document, path, next));

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
        patch({ value: dataUrl });
        onNotice(t("document.photo.updated"), "info");
      })
      .catch(() => onNotice(t("document.photo.readFailed"), "warning"));
  };

  if (isPhoto) {
    return (
      <div className="document-item-editor document-header-editor" data-document-path={path}>
        <div className="document-photo-editor">
          <div className="document-photo-frame">
            {photo ? (
              <img src={photo} alt={t("document.photo.thumbnail")} />
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
              onClick={() => {
                setDraft(DEFAULT_CROP_DRAFT);
                setCropOpen(true);
              }}
            >
              {t("document.photo.crop")}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={readOnly || !photo}
              onClick={() => {
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
          draft={draft}
          onDraftChange={setDraft}
          onClose={() => setCropOpen(false)}
          onApply={(dataUrl) => patch({ value: dataUrl })}
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
      <Input
        size="small"
        aria-label={label}
        placeholder={t("document.field.valuePlaceholder")}
        value={item.value}
        disabled={readOnly}
        onChange={(event) => patch({ value: event.target.value })}
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
