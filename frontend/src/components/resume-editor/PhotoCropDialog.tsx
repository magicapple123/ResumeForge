// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台里的照片裁剪弹窗（#25 / 任务 6 / 2026-11 #18）。
 *
 * ## 非破坏
 *
 * 原图引用（`content.photo`）一个字节都不动：这里只产出 `photo_crop` 参数
 * （`version / source / rect / aspect`），后端 `resolve_photo_crop` 按它派生裁剪图，
 * HTML / PDF / Word 三个渲染器都消费同一份，「恢复原图」= 删掉这个域。
 *
 * ## #18：从"三个滑块 + draft"改成"直接操作 CropRect"
 *
 * 旧实现的界面状态是 `PhotoCropDraft = {aspect, zoom, offsetX, offsetY}`，提交时才
 * 换算成矩形。裁剪框（`PhotoCropBox`）只能表达"矩形"，于是这里改成**唯一状态就是
 * `CropRect`**：
 *
 * - 打开时 `initialCrop.rect` 有就还原，没有就按当前比例给一个居中默认矩形；
 * - 拖动 / 键盘 / 换比例都直接改 `rect`（局部状态，不落库）；
 * - 「应用裁剪」一次提交 `createRectCropParams(source, rect, aspect)`。
 *
 * ## 换照片后旧裁剪自动失效（验收 6）
 *
 * `source.sha256` 是原图 data URL 的哈希。弹窗里比对 `initialCrop.source.sha256` 与
 * **当前照片**的哈希：不一致就当作"没有裁剪"，避免"新照片套旧取景"。
 */
import Button from "antd/es/button";
import Modal from "antd/es/modal";
import Segmented from "antd/es/segmented";
import Typography from "antd/es/typography";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/i18nContext";
import type { MessageKey } from "../../i18n";
import {
  buildPhotoSource,
  clampCropRect,
  createRectCropParams,
  cropRectAspect,
  defaultCropRect,
  fitCropRectToAspect,
  PHOTO_CROP_ASPECTS,
  type CropRect,
  type PhotoAspect,
  type PhotoCropParams,
} from "../../features/resume-proview/photoCrop";
import {
  DEFAULT_PRINTED_WIDTH_MM,
  estimateRectClarity,
} from "../../features/resume-proview/photoClarity";
import { usePhotoDimensions } from "../../features/resume-proview/usePhotoDimensions";
import PhotoCropBox from "../resume/photo-crop/PhotoCropBox";

const ASPECT_KEYS: Record<PhotoAspect, MessageKey> = {
  free: "proview.photo.aspect.original",
  "1:1": "proview.photo.aspect.square",
  "3:4": "proview.photo.aspect.portrait",
  "4:5": "proview.photo.aspect.landscape",
};

/** 全幅（没有真正裁剪）：与「恢复原图」同义。 */
const FULL_FRAME: CropRect = { x: 0, y: 0, w: 1, h: 1 };

interface Props {
  open: boolean;
  /** 原图 data URL（页眉照片当前的值；**不是**上次裁剪的结果）。 */
  photo: string;
  /** 已保存的裁剪参数（打开时还原）；`null` = 还没裁过。 */
  initialCrop: PhotoCropParams | null;
  onClose: () => void;
  /** `params = null` 表示「恢复原图」（删掉 `photo_crop` 域）。 */
  onApply: (params: PhotoCropParams | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function PhotoCropDialog({
  open,
  photo,
  initialCrop,
  onClose,
  onApply,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const dimensions = usePhotoDimensions(open ? photo : null);
  const source = dimensions ? buildPhotoSource(photo, dimensions.width, dimensions.height) : null;
  // 照片换了（哈希不一致）→ 旧裁剪失效，不能把旧取景套到新照片上。
  const cropInvalidated = Boolean(
    source && initialCrop && initialCrop.source.sha256 !== source.sha256,
  );
  const activeCrop = cropInvalidated ? null : initialCrop;

  const [aspect, setAspect] = useState<PhotoAspect>(activeCrop?.aspect ?? "free");
  const [rect, setRect] = useState<CropRect>(
    activeCrop ? clampCropRect(activeCrop.rect) : FULL_FRAME,
  );

  // 打开时按"已保存参数"还原；没有就从当前比例的默认矩形开始。
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      const nextAspect: PhotoAspect = activeCrop?.aspect ?? "free";
      setAspect(nextAspect);
      setRect(activeCrop ? clampCropRect(activeCrop.rect) : FULL_FRAME);
    }
  }

  // 换照片后旧裁剪失效：把框与比例一起复位，避免"新照片套旧取景"。
  useEffect(() => {
    if (!cropInvalidated) return;
    setAspect("free");
    setRect(FULL_FRAME);
  }, [cropInvalidated]);

  const sourceWidth = dimensions?.width ?? 0;
  const sourceHeight = dimensions?.height ?? 0;
  // 尺寸是异步解码出来的：首次打开时若锁定比例，拿到真尺寸后把"整幅"换成该比例的居中矩形
  // （用户已经拖过就不动——`current` 不再是整幅时直接返回）。
  useEffect(() => {
    if (!open || sourceWidth <= 0 || sourceHeight <= 0 || activeCrop) return;
    if (aspect === "free") return;
    setRect((current) => {
      if (current.w < 0.9999 || current.h < 0.9999) return current;
      return defaultCropRect(aspect, { sha256: "", width: sourceWidth, height: sourceHeight });
    });
  }, [open, sourceWidth, sourceHeight, aspect, activeCrop]);

  const safeRect = clampCropRect(rect);
  const previewParams = source ? createRectCropParams(source, safeRect, aspect) : null;
  const previewRatio = cropRectAspect(safeRect, source);
  const clarity = source ? estimateRectClarity(source, safeRect, DEFAULT_PRINTED_WIDTH_MM) : null;

  const selectAspect = (next: PhotoAspect) => {
    setAspect(next);
    setRect((current) => fitCropRectToAspect(current, next, source));
  };

  const apply = () => {
    if (!previewParams) {
      onNotice(t("document.photo.cropFailed"), "warning");
      return;
    }
    onApply(previewParams);
    onClose();
  };

  /** 「恢复原图」：删掉裁剪参数（`onApply(null)`），框同时复位到"整张原图"。 */
  const restoreOriginal = () => {
    setAspect("free");
    setRect(FULL_FRAME);
    onApply(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("document.photo.cropTitle")}
      onCancel={onClose}
      width={620}
      footer={[
        <Button key="reset" onClick={restoreOriginal} disabled={!source}>
          {t("proview.photo.reset")}
        </Button>,
        <Button key="cancel" onClick={onClose}>
          {t("common.action.cancel")}
        </Button>,
        <Button key="apply" type="primary" onClick={apply} disabled={!source}>
          {t("document.photo.cropApply")}
        </Button>,
      ]}
    >
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
        {t("proview.photo.hint")}
      </Typography.Text>
      <PhotoCropBox
        photo={photo}
        source={source}
        rect={safeRect}
        aspect={aspect}
        disabled={!source}
        onChange={setRect}
      />
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginTop: 12,
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.aspect")}</Typography.Text>
          <Segmented
            size="small"
            block
            aria-label={t("proview.photo.aspect")}
            value={aspect}
            options={PHOTO_CROP_ASPECTS.map((value) => ({
              value,
              label: t(ASPECT_KEYS[value]),
            }))}
            onChange={(next) => selectAspect(next as PhotoAspect)}
            style={{ marginBottom: 8 }}
          />
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            {source
              ? t("proview.photo.source", { width: source.width, height: source.height })
              : t("document.photo.cropLoading")}
          </Typography.Text>
        </div>
        <div style={{ flex: "0 0 120px" }}>
          <div
            role="img"
            aria-label={t("document.photo.cropPreview")}
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: previewRatio > 0 ? String(previewRatio) : "3 / 4",
              overflow: "hidden",
              background: "var(--rf-surface-alt)",
              borderRadius: 4,
            }}
          >
            {safeRect.w > 0 && safeRect.h > 0 ? (
              <img
                src={photo}
                alt=""
                style={{
                  position: "absolute",
                  width: `${100 / safeRect.w}%`,
                  height: `${100 / safeRect.h}%`,
                  left: `${(-safeRect.x / safeRect.w) * 100}%`,
                  top: `${(-safeRect.y / safeRect.h) * 100}%`,
                  maxWidth: "none",
                  userSelect: "none",
                }}
              />
            ) : null}
          </div>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 4, fontSize: 12 }}
          >
            {t("proview.photo.previewLabel")}
          </Typography.Text>
        </div>
      </div>
      {clarity ? (
        <Typography.Text
          type={clarity.level === "ok" ? "secondary" : "warning"}
          style={{ display: "block", marginTop: 10, fontSize: 12 }}
        >
          {clarity.level === "ok"
            ? t("proview.photo.clarity.ok", {
                width: clarity.pixelWidth,
                height: clarity.pixelHeight,
              })
            : t("proview.photo.clarity.warn", {
                width: clarity.pixelWidth,
                height: clarity.pixelHeight,
              })}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}
