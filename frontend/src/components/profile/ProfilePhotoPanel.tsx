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
      message.error("请选择 JPG、PNG 或 WebP 格式的照片");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      message.error(`照片不能超过 ${PHOTO_MAX_BYTES / (1024 * 1024)} MB`);
      return;
    }
    if (photos.length >= MAX_PROFILE_PHOTOS) {
      message.warning(`最多保存 ${MAX_PROFILE_PHOTOS} 张照片，请先删除不再使用的`);
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
      message.success("照片已保存，可在下方切换使用哪一张");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传照片失败");
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
      message.success("已切换简历照片");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换照片失败");
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
      message.success("已删除这张照片");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除照片失败");
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
      hint="松开即可上传照片"
      onFiles={(dropped) => void upload(dropped[0])}
      onRejected={() => message.error("只支持 JPG、PNG 或 WebP 照片")}
    >
      <div className="profile-photo-panel">
        <div className="profile-photo-frame">
          {activePhoto ? (
            // 允许点开放大：简历照片是用户文件副本库的一部分，原图预览是最自然的入口。
            <Image src={activePhoto} alt="简历照片" />
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
              {activePhoto ? "上传新照片" : "选择照片"}
            </Button>
          </Upload>
          {alternateCount > 0 && (
            <Button icon={<PictureOutlined />} onClick={() => setLibraryOpen(true)}>
              照片库（{photos.length}）
            </Button>
          )}
        </Space>
        {uploadPercent !== null && (
          <Progress
            aria-label="照片上传进度"
            percent={uploadPercent}
            size="small"
            status={uploadPercent >= 100 ? "success" : "active"}
            style={{ maxWidth: 320 }}
          />
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {loading
            ? "正在读取照片…"
            : `JPG、PNG 或 WebP，最大 ${PHOTO_MAX_BYTES / (1024 * 1024)} MB，最多保存 ${MAX_PROFILE_PHOTOS} 张`}
        </Typography.Text>

        <Modal
          title="照片库"
          open={libraryOpen}
          onCancel={() => setLibraryOpen(false)}
          footer={null}
          width={420}
          destroyOnHidden
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            点一张设为简历照片；简历上只会用你选中的这一张。
          </Typography.Paragraph>
          <div className="profile-photo-library">
            {photos.map((photo) => {
              const isActive = photo.id === activeId;
              return (
                <div
                  key={photo.id}
                  className={`profile-photo-thumb${isActive ? " is-active" : ""}`}
                >
                  <Tooltip title={isActive ? "当前使用中" : "设为简历照片"}>
                    <button
                      type="button"
                      className="profile-photo-thumb-button"
                      disabled={disabled || busy || isActive}
                      aria-label={`使用照片 ${photo.name || photo.id}`}
                      onClick={() => void selectPhoto(photo)}
                    >
                      <img src={photo.image} alt={photo.name || "照片"} />
                      {isActive && <Tag color="blue">使用中</Tag>}
                    </button>
                  </Tooltip>
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={`删除照片 ${photo.name || photo.id}`}
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
              还没有备选照片。上传新照片后就会出现在这里，可以随时切换。
            </Typography.Text>
          )}
        </Modal>
      </div>
    </FileDropZone>
  );
}
