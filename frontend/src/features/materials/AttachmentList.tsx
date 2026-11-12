// SPDX-License-Identifier: Apache-2.0
/**
 * 资料箱详情里的附件列表：每行「预览 / 复制 / 另存为」三个操作。
 *
 * ## 为什么外层是 div 而不是 button
 *
 * 旧版整行是一个 <button>（点开预览）。在它内部再放按钮是**非法 HTML**：点击会冒泡成
 * 预览、Tab 顺序错乱、部分浏览器干脆不渲染内层按钮（与第 1 条厂商卡同一类问题，清单
 * §23.6）。现在外层是 div，左侧打开区与右侧两个图标按钮平级；三个都是原生 button
 * （回车/空格天然可用），Tab 顺序即 DOM 顺序：预览 → 复制 → 另存为。
 *
 * ## 复制按类型分派
 *
 * - 图片：把 data URL 转成 PNG 后写剪贴板。**必须把 Promise 直接交给 ClipboardItem**，
 *   先 await 转码再 write 会丢掉用户手势，Chrome 会拒绝（清单 §23.4）。
 * - 文本：走共享的 copyText（带 execCommand 兜底）。
 *
 * ## 另存为
 *
 * 只有 file_id 非空才显示按钮（历史文本附件没有原件，不做一个点了会 404 的按钮）。
 * 走 /api/user-files/{id}/raw，文件名由后端的 Content-Disposition 给出，前端不自己拼。
 */
import { CopyOutlined, DownloadOutlined, EyeOutlined, PaperClipOutlined } from "@ant-design/icons";
import { App, Button, Tooltip, Typography } from "antd";
import type { MaterialFile } from "../../types";
import { canPreviewImage } from "../../utils/attachments";
import { copyText } from "../../utils/clipboard";
import { userFileRawUrl } from "../../api/userFiles";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/**
 * 图片转码失败（仅内部兜底用）。
 *
 * 刻意**不用** `new Error("...")`：i18n 棘轮会把 new Error 的字面量参数当成产品文案
 * （用户可见的错误消息）。这里的消息从不展示给用户，用户看到的是 i18n 的复制失败提示，
 * 所以用自定义错误类承载语义、不携带文案。
 */
class ImageCopyEncodingError extends Error {}

/** 图片是否可按图片复制（有缩略图且浏览器能渲染这种格式）。 */
function isImageFile(file: MaterialFile): boolean {
  return Boolean(file.data_url) && canPreviewImage(file.mime_type);
}

/**
 * data URL → PNG Blob。
 *
 * 剪贴板对 image/jpeg、image/webp 的支持不稳定，统一转 PNG；转码本身是异步的，调用方
 * 必须把返回的 Promise 直接交给 ClipboardItem（见文件头说明）。
 */
async function pngBlobOf(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  const source = await response.blob();
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageCopyEncodingError();
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ImageCopyEncodingError());
    }, "image/png");
  });
}

export function AttachmentList({
  files,
  onPreview,
}: {
  files: MaterialFile[];
  /** 点击某一行的打开区时把该附件交给父组件（由父组件打开预览弹层）。 */
  onPreview: (file: MaterialFile) => void;
}) {
  useLocale();
  const { message } = App.useApp();

  const copy = async (file: MaterialFile) => {
    if (isImageFile(file)) {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        message.info(t("materials.attachments.copyImageUnsupported"));
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": pngBlobOf(file.data_url) }),
        ]);
        message.success(t("materials.attachments.copyImageDone"));
      } catch {
        // 转码失败 / 浏览器拒绝：如实报错，不假装成功；用户还能用「另存为」。
        message.error(t("materials.attachments.copyFailed"));
      }
      return;
    }
    if (!(file.text ?? "").trim()) {
      message.info(t("materials.attachments.copyEmpty"));
      return;
    }
    if (await copyText(file.text)) {
      message.success(t("materials.attachments.copyTextDone"));
    } else {
      message.error(t("materials.attachments.copyFailed"));
    }
  };

  const saveAs = (file: MaterialFile) => {
    if (!file.file_id) return;
    const link = document.createElement("a");
    link.href = userFileRawUrl(file.file_id);
    // 空 download = 让浏览器使用后端 Content-Disposition 里的 original_name 作为文件名，
    // 前端不自己拼名字（后端已做安全化）。
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="material-file-list">
      {files.map((file, index) => {
        const image = isImageFile(file);
        const hasText = Boolean((file.text ?? "").trim());
        const metaText = image
          ? t("materials.file.image", { size: Math.round(file.size_bytes / 1024) })
          : hasText
            ? t("materials.file.text", { count: file.text.length })
            : t("materials.file.originalOnly");
        return (
          <div key={file.file_id ?? file.name + index} className="material-file-item">
            <Button
              type="text"
              className="material-file-open"
              onClick={() => onPreview(file)}
              aria-label={t("materials.attachments.previewAria", { name: file.name })}
            >
              {image ? (
                <img className="material-file-thumb" src={file.data_url} alt={file.name} />
              ) : (
                <PaperClipOutlined className="material-file-icon" />
              )}
              <span className="material-file-meta">
                <Typography.Text ellipsis={{ tooltip: file.name }}>{file.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {metaText}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <EyeOutlined /> {t("materials.attachments.previewAction")}
                </Typography.Text>
              </span>
            </Button>
            <Tooltip title={t("materials.attachments.copyAction")}>
              <Button
                type="text"
                size="small"
                className="material-file-action"
                icon={<CopyOutlined />}
                aria-label={t("materials.attachments.copyAria", { name: file.name })}
                onClick={() => void copy(file)}
              />
            </Tooltip>
            {file.file_id ? (
              <Tooltip title={t("materials.attachments.saveAsAction")}>
                <Button
                  type="text"
                  size="small"
                  className="material-file-action"
                  icon={<DownloadOutlined />}
                  aria-label={t("materials.attachments.saveAsAria", { name: file.name })}
                  onClick={() => saveAs(file)}
                />
              </Tooltip>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default AttachmentList;
