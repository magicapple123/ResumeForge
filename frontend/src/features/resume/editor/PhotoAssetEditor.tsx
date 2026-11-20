// SPDX-License-Identifier: Apache-2.0
/**
 * 照片的「预览 + 更换 / 裁剪 / 删除」**唯一一份实现**（T02）。
 *
 * 两个宿主共用它：
 * - 中栏页眉字段编辑器（`HeaderItemEditor`）→ `variant="compact"`：缩略图靠左、按钮跟在后面；
 * - 左栏「排版参数」→「照片」分组（`PhotoTab`）→ `variant="full"`：缩略图铺满一列，按钮在下方。
 *
 * ## 为什么必须共用
 *
 * 上传有三条规则（5MB 上限、jpeg/png/webp、换图必须清裁剪）。复制一份就会出现两套错误文案，
 * 而"换图没清裁剪"不会报错——它只会让下一次裁剪拿着一张已经不存在的图去取景。
 *
 * ## `photo` 是**文档里的当前值**，不是"已保存的详情"
 *
 * 裁剪按钮的可用性只看 `photo` 非空。若宿主把"已保存详情"里的 `hasPhoto` 传进来，
 * 上传后缩略图已经出来、裁剪按钮却还是灰的（T02 明确要防的假 bug）。
 */
import { CameraOutlined, DeleteOutlined, ScissorOutlined } from "@ant-design/icons";
import { Button, Space, Upload } from "antd";
import { useState } from "react";

import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { PhotoCropParams } from "../preview/photoCrop";
import { readAsDataUrl } from "../../../utils/attachments";
import CroppedPhotoThumb from "./CroppedPhotoThumb";
import PhotoCropDialog from "./PhotoCropDialog";

/** 与后端 `resume_photo` 的白名单一致；改这里要同批改后端。 */
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** 5MB：base64 之后约 6.7MB，仍在单条文档的可接受范围内。 */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  /** 当前照片（data URL）；空串 = 没有照片。 */
  photo: string;
  /** 当前裁剪参数（来自 `format_config.photo_crop`）。 */
  crop: PhotoCropParams | null;
  disabled?: boolean;
  variant?: "compact" | "full";
  /** 换图 / 移除：宿主负责**同批清掉裁剪**（sha 指向旧图）。 */
  onPhotoChange: (dataUrl: string) => void;
  /** 裁剪：只有拿到 `format_config` 写通道时才传。 */
  onCropChange?: (params: PhotoCropParams | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function PhotoAssetEditor({
  photo,
  crop,
  disabled = false,
  variant = "compact",
  onPhotoChange,
  onCropChange,
  onNotice,
}: Props) {
  useLocale();
  const [cropOpen, setCropOpen] = useState(false);

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
        onPhotoChange(dataUrl);
        onNotice(t("document.photo.updated"), "info");
      })
      .catch(() => onNotice(t("document.photo.readFailed"), "warning"));
  };

  return (
    <div className={`document-photo-editor is-${variant}`}>
      {/* 5.2：`is-full` 下框按图片比例定形（`height: auto`），空态没有图片撑高，
          会塌成一条贴左上的细线——`is-empty` 让样式表把它恢复成居中的 72×90。 */}
      <div className={`document-photo-frame${photo ? "" : " is-empty"}`}>
        {photo ? (
          <CroppedPhotoThumb
            photo={photo}
            crop={crop}
            className="document-photo-thumb"
            alt={t("document.photo.thumbnail")}
          />
        ) : (
          <span className="document-photo-empty">{t("document.photo.empty")}</span>
        )}
      </div>
      <Space wrap size={6}>
        <Upload
          accept="image/jpeg,image/png,image/webp"
          showUploadList={false}
          disabled={disabled}
          beforeUpload={(file) => {
            uploadPhoto(file as File);
            return Upload.LIST_IGNORE;
          }}
        >
          <Button size="small" icon={<CameraOutlined />} disabled={disabled}>
            {t("document.photo.replace")}
          </Button>
        </Upload>
        <Button
          size="small"
          icon={<ScissorOutlined />}
          // 可用性只由"有没有照片"决定（旧契约）：没有写回通道时点开也能看，
          // 点「应用」才提示"没能写入"——不要用一个灰按钮把入口藏掉。
          disabled={disabled || !photo}
          onClick={() => setCropOpen(true)}
        >
          {t("document.photo.crop")}
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          disabled={disabled || !photo}
          onClick={() => {
            onPhotoChange("");
            onNotice(t("document.photo.removed"), "info");
          }}
        >
          {t("document.photo.remove")}
        </Button>
      </Space>
      <PhotoCropDialog
        open={cropOpen}
        photo={photo}
        initialCrop={crop}
        onClose={() => setCropOpen(false)}
        onApply={(params) => {
          if (!onCropChange) {
            onNotice(t("document.photo.cropFailed"), "warning");
            return;
          }
          onCropChange(params);
          onNotice(params ? t("document.photo.cropped") : t("proview.photo.cleared"), "info");
        }}
        onNotice={onNotice}
      />
    </div>
  );
}
