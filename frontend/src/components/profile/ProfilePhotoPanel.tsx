// SPDX-License-Identifier: Apache-2.0
/** 简历照片面板：保存多张照片，选择其中一张用于简历。
 *
 * **界面上只显示"正在使用"的那一张**：此前大图 + 下方缩略图并列，同一张脸在同一个卡片里
 * 出现两次，看起来像存了两张照片（截图反馈）。备选照片因此移到一个「照片库」弹窗里，
 * 那里本来就该承担"挑一张"的动作——卡片本身只回答"简历上用的是哪张"。
 */

import { CameraOutlined, DeleteOutlined, PictureOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Image, Modal, Progress, Space, Tag, Tooltip, Typography, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  createProfilePhoto,
  deleteProfilePhoto,
  listProfilePhotos,
  updateProfilePhoto,
} from "../../api/photo";
import { MAX_PROFILE_PHOTOS, type ProfilePhoto } from "../../types";
import { readAsDataUrl } from "../../utils/attachments";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import FileDropZone from "../common/FileDropZone";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  /** 当前用于简历的那张（来自资料表单，可能是刚上传还没保存的新照片）。 */
  activePhoto: string;
  disabled?: boolean;
  /** 切换照片时同步到资料表单，保存资料后与后端保持一致。 */
  onSelect: (dataUrl: string) => void;
}

export default function ProfilePhotoPanel({ activePhoto, disabled = false, onSelect }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 照片上传进度（0-100；null 表示不在上传中）：5 MB 照片 base64 后近 6.7 MB，
  // 在按钮旁画一条进度条比一个 loading 图标更直观。
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const photos = await listProfilePhotos();
        if (!cancelled) setPhotos(photos);
      } catch {
        // 照片列表取不到不影响资料编辑，静默退回"只有当前照片"。
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 事件路径（上传/删除后的整表重拉）。已由上方内联 IIFE 取代挂载调用。
  const load = useCallback(async () => {
    try {
      setPhotos(await listProfilePhotos());
    } catch {
      // 照片列表取不到不影响资料编辑，静默退回"只有当前照片"。
    } finally {
      setLoading(false);
    }
  }, []);

  const upload = async (file: File) => {
    if (!PHOTO_TYPES.has(file.type)) {
      message.error(t("profilePhoto.upload.formatError"));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      message.error(t("profilePhoto.upload.tooLarge", { size: PHOTO_MAX_BYTES / (1024 * 1024) }));
      return;
    }
    if (photos.length >= MAX_PROFILE_PHOTOS) {
      message.warning(t("profilePhoto.upload.limit", { count: MAX_PROFILE_PHOTOS }));
      return;
    }
    setBusy(true);
    setUploadPercent(0);
    try {
      const dataUrl = await readAsDataUrl(file);
      const created = await createProfilePhoto(
        dataUrl,
        file.name.replace(/\.[^.]+$/, ""),
        (percent) => setUploadPercent(percent),
      );
      await load();
      // 第一张上传的照片会自动成为使用中的那张。
      onSelect(created.image);
      message.success(t("profilePhoto.upload.success"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("profilePhoto.upload.failed"));
    } finally {
      setBusy(false);
      setUploadPercent(null);
    }
  };

  /** 把某张照片设为简历照片（函数名以 select 开头：以 use 开头会被当成 Hook）。 */
  const selectPhoto = async (photo: ProfilePhoto) => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await updateProfilePhoto(photo.id, { is_primary: true });
      await load();
      onSelect(updated.image);
      message.success(t("profilePhoto.switch.success"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("profilePhoto.switch.failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photo: ProfilePhoto) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteProfilePhoto(photo.id);
      const next = await listProfilePhotos();
      setPhotos(next);
      // 删掉的正是当前照片时，后端会把下一张设为主照片；表单也要跟着换。
      if (photo.is_primary || next.every((item) => !item.is_primary)) {
        onSelect(next.find((item) => item.is_primary)?.image ?? "");
      }
      // 删到只剩一张时照片库自动关上：里面已经没得挑了，留着反而是个空弹窗。
      if (next.length <= 1) setLibraryOpen(false);
      message.success(t("profilePhoto.delete.success"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("profilePhoto.delete.failed"));
    } finally {
      setBusy(false);
    }
  };

  /** 「使用中」的唯一口径：先按字节匹配表单当前照片，同 bytes 多条时以主照片记录为准，
   *  再退到第一条匹配——没有匹配就谁都不亮（表单可能是还没入库的新照片）。 */
  const matched = photos.filter((photo) => photo.image === activePhoto);
  const activeId = matched.find((photo) => photo.is_primary)?.id ?? matched[0]?.id;
  /** 除当前照片外还有几张备选——决定「照片库」按钮上要不要带数字。 */
  const alternateCount = photos.filter((photo) => photo.id !== activeId).length;

  return (
    <FileDropZone
      accept="image/jpeg,image/png,image/webp"
      disabled={disabled || busy}
      hint={t("profilePhoto.upload.dropHint")}
      onFiles={(dropped) => void upload(dropped[0])}
      onRejected={() => message.error(t("profilePhoto.upload.dropRejected"))}
    >
      <div className="profile-photo-panel">
        <div className="profile-photo-frame">
          {activePhoto ? (
            // 允许点开放大：简历照片是用户文件副本库的一部分，原图预览是最自然的入口。
            <Image src={activePhoto} alt={t("profilePhoto.preview.alt")} />
          ) : (
            <UserOutlined className="profile-photo-placeholder" />
          )}
        </div>
        <Space wrap>
          <Upload
            accept="image/jpeg,image/png,image/webp"
            beforeUpload={(file) => {
              void upload(file as File);
              return Upload.LIST_IGNORE;
            }}
            showUploadList={false}
            disabled={disabled || busy}
          >
            <Button icon={<CameraOutlined />} loading={busy}>
              {activePhoto ? t("profilePhoto.action.uploadNew") : t("profilePhoto.action.choose")}
            </Button>
          </Upload>
          {alternateCount > 0 && (
            <Button icon={<PictureOutlined />} onClick={() => setLibraryOpen(true)}>
              {t("profilePhoto.action.library", { count: photos.length })}
            </Button>
          )}
        </Space>
        {uploadPercent !== null && (
          <Progress
            aria-label={t("profilePhoto.upload.progress")}
            percent={uploadPercent}
            size="small"
            status={uploadPercent >= 100 ? "success" : "active"}
            style={{ maxWidth: 320 }}
          />
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {loading
            ? t("profilePhoto.upload.loading")
            : t("profilePhoto.upload.formatsHint", {
                size: PHOTO_MAX_BYTES / (1024 * 1024),
                count: MAX_PROFILE_PHOTOS,
              })}
        </Typography.Text>

        <Modal
          title={t("profilePhoto.library.title")}
          open={libraryOpen}
          onCancel={() => setLibraryOpen(false)}
          footer={null}
          width={420}
          destroyOnHidden
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            {t("profilePhoto.library.description")}
          </Typography.Paragraph>
          <div className="profile-photo-library">
            {photos.map((photo) => {
              const isActive = photo.id === activeId;
              return (
                <div
                  key={photo.id}
                  className={`profile-photo-thumb${isActive ? " is-active" : ""}`}
                >
                  <Tooltip
                    title={
                      isActive
                        ? t("profilePhoto.library.tooltipActive")
                        : t("profilePhoto.library.tooltipSelect")
                    }
                  >
                    <button
                      type="button"
                      className="profile-photo-thumb-button"
                      disabled={disabled || busy || isActive}
                      aria-label={t("profilePhoto.library.selectAria", {
                        name: photo.name || photo.id,
                      })}
                      onClick={() => void selectPhoto(photo)}
                    >
                      <img
                        src={photo.image}
                        alt={photo.name || t("profilePhoto.library.photoAlt")}
                      />
                      {isActive && <Tag color="blue">{t("profilePhoto.library.activeTag")}</Tag>}
                    </button>
                  </Tooltip>
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={t("profilePhoto.library.deleteAria", {
                      name: photo.name || photo.id,
                    })}
                    icon={<DeleteOutlined />}
                    disabled={disabled || busy}
                    onClick={() => void remove(photo)}
                  />
                </div>
              );
            })}
          </div>
          {photos.length <= 1 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("profilePhoto.library.empty")}
            </Typography.Text>
          )}
        </Modal>
      </div>
    </FileDropZone>
  );
}
