// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台里的照片裁剪（#25）：把页眉照片**裁成新的 data URL**。
 *
 * ## 为什么不是复用预览那张裁剪弹窗
 *
 * `proview` 的裁剪是**非破坏**的：它只产出 `photo_crop` 参数，纸面渲染时由后端派生。
 * v2 文档里没有这个参数域——页眉照片的值就是 data URL 本身（`basic_info.photo`）。
 * 因此这里的裁剪真的会写出一张新图：几何算法复用同一套（`computeCropRect` /
 * `buildPhotoSource` / 比例档位），落地方式换成 canvas。
 *
 * 原图不会被静默覆盖：资料里的照片库仍保有原图，制作台只改这份简历文档引用的那张；
 * 用户可以对同一张图重复裁剪（每次都在当前值上裁）。
 */
import { Modal } from "antd";
import Button from "antd/es/button";
import Segmented from "antd/es/segmented";
import Slider from "antd/es/slider";
import Typography from "antd/es/typography";
import { useRef } from "react";
import { useI18n } from "../../i18n/i18nContext";
import {
  buildPhotoSource,
  computeCropRect,
  DEFAULT_CROP_DRAFT,
  PHOTO_CROP_ASPECTS,
  type PhotoAspect,
  type PhotoCropDraft,
} from "../../features/resume-proview/photoCrop";
import { usePhotoDimensions } from "../../features/resume-proview/usePhotoDimensions";
import type { MessageKey } from "../../i18n";

const ASPECT_KEYS: Record<PhotoAspect, MessageKey> = {
  free: "proview.photo.aspect.original",
  "1:1": "proview.photo.aspect.square",
  "3:4": "proview.photo.aspect.portrait",
  "4:5": "proview.photo.aspect.landscape",
};

interface Props {
  open: boolean;
  /** 原图 data URL（当前页眉照片的值）。 */
  photo: string;
  draft: PhotoCropDraft;
  onDraftChange: (next: PhotoCropDraft) => void;
  onClose: () => void;
  onApply: (dataUrl: string) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function PhotoCropDialog({
  open,
  photo,
  draft,
  onDraftChange,
  onClose,
  onApply,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLImageElement>(null);
  const dimensions = usePhotoDimensions(open ? photo : null);
  const source = dimensions ? buildPhotoSource(photo, dimensions.width, dimensions.height) : null;
  const rect = source ? computeCropRect(source, draft) : null;
  const previewRatio =
    source && rect && rect.h > 0 && rect.w > 0
      ? (rect.w * source.width) / (rect.h * source.height)
      : undefined;

  const apply = () => {
    const image = imageRef.current;
    if (!source || !rect || !image || !image.complete || image.naturalWidth <= 0) {
      onNotice(t("document.photo.cropFailed"), "warning");
      return;
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      onNotice(t("document.photo.cropFailed"), "warning");
      return;
    }
    const sx = Math.round(rect.x * source.width);
    const sy = Math.round(rect.y * source.height);
    const sw = Math.max(1, Math.round(rect.w * source.width));
    const sh = Math.max(1, Math.round(rect.h * source.height));
    canvas.width = sw;
    canvas.height = sh;
    try {
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      if (!dataUrl) {
        onNotice(t("document.photo.cropFailed"), "warning");
        return;
      }
      onApply(dataUrl);
      onNotice(t("document.photo.cropped"), "info");
      onClose();
    } catch {
      onNotice(t("document.photo.cropFailed"), "warning");
    }
  };

  return (
    <Modal
      open={open}
      title={t("document.photo.cropTitle")}
      onCancel={onClose}
      width={560}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t("common.action.cancel")}
        </Button>,
        <Button key="apply" type="primary" onClick={apply} disabled={!source}>
          {t("document.photo.cropApply")}
        </Button>,
      ]}
    >
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
        {t("document.photo.cropHint")}
      </Typography.Text>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div
          role="img"
          aria-label={t("document.photo.cropPreview")}
          style={{
            position: "relative",
            flex: "0 1 200px",
            minWidth: 150,
            overflow: "hidden",
            width: "100%",
            aspectRatio: previewRatio ? String(previewRatio) : "3 / 4",
            background: "var(--rf-surface-alt)",
            borderRadius: 6,
          }}
        >
          {rect ? (
            <img
              ref={imageRef}
              src={photo}
              alt={t("document.photo.cropPreview")}
              style={{
                position: "absolute",
                width: `${100 / rect.w}%`,
                height: `${100 / rect.h}%`,
                left: `${(-rect.x / rect.w) * 100}%`,
                top: `${(-rect.y / rect.h) * 100}%`,
                maxWidth: "none",
                userSelect: "none",
              }}
            />
          ) : (
            <Typography.Text
              type="secondary"
              style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
            >
              {t("document.photo.cropLoading")}
            </Typography.Text>
          )}
        </div>
        {source ? (
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            {t("proview.photo.source", { width: source.width, height: source.height })}
          </Typography.Text>
        ) : null}
        <div style={{ flex: "1 1 240px", minWidth: 220, display: "grid", gap: 10 }}>
          <div>
            <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.aspect")}</Typography.Text>
            <Segmented
              size="small"
              block
              aria-label={t("proview.photo.aspect")}
              value={draft.aspect}
              options={PHOTO_CROP_ASPECTS.map((value) => ({
                value,
                label: t(ASPECT_KEYS[value]),
              }))}
              onChange={(next) => onDraftChange({ ...draft, aspect: next as PhotoAspect })}
            />
          </div>
          <div>
            <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.zoom")}</Typography.Text>
            <Slider
              min={35}
              max={100}
              step={1}
              value={Math.round(draft.zoom * 100)}
              ariaLabelForHandle={t("proview.photo.zoomAria")}
              onChange={(value: number) => onDraftChange({ ...draft, zoom: value / 100 })}
            />
          </div>
          <div>
            <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.offsetX")}</Typography.Text>
            <Slider
              min={-100}
              max={100}
              value={Math.round(draft.offsetX * 100)}
              ariaLabelForHandle={t("proview.photo.offsetXAria")}
              onChange={(value: number) => onDraftChange({ ...draft, offsetX: value / 100 })}
            />
          </div>
          <div>
            <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.offsetY")}</Typography.Text>
            <Slider
              min={-100}
              max={100}
              value={Math.round(draft.offsetY * 100)}
              ariaLabelForHandle={t("proview.photo.offsetYAria")}
              onChange={(value: number) => onDraftChange({ ...draft, offsetY: value / 100 })}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** 初始草稿（打开裁剪弹窗时用；比例跟随原图）。 */
export const INITIAL_PHOTO_CROP_DRAFT: PhotoCropDraft = DEFAULT_CROP_DRAFT;
