// SPDX-License-Identifier: Apache-2.0
/**
 * 识别前暂存文件的**预览**（T6 / 项 7）：预览的是上传的文件本身，不是识别结果。
 *
 * 三种形态：
 * - 图片：48×48 缩略图。同一次暂存的多张图由调用方包在 `Image.PreviewGroup` 里，
 *   点开可以左右切换/缩放（这里只管画自己那一个）。
 * - PDF：**服务端渲染首页位图**，点「预览」在弹层里看（D14）。原先前端是
 *   `window.open(dataUrl)` 交给浏览器内置阅读器——那条路在 Chrome/Edge 上早已被禁止
 *   （顶层导航到 `data:` 会被拦），Electron 根本没有内置查看器，所以必然失败。
 * - docx：浏览器没有原生渲染能力，只能说明"识别时会提取文字"，不给预览按钮——
 *   给一个点了会下载/报错的按钮比没有按钮更糟。
 */
import { FilePdfOutlined, FileWordOutlined, PictureOutlined } from "@ant-design/icons";
import { App, Button, Image, Modal, Space, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import type { PdfPreviewPage } from "../api/attachments";
import { previewPdf } from "../api/attachments";
import type { StagedFile } from "../hooks/useRecognitionFiles";
import { canPreviewImage } from "../utils/attachments";

/** 体积文案：B / KB / MB（MB 保留一位小数）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 是否按 PDF 处理：MIME 与扩展名任一命中即可（用户给的 MIME 不一定可信）。 */
export function isPdfFile(file: StagedFile): boolean {
  const mime = file.mime_type.split(";", 1)[0].trim().toLowerCase();
  return mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function FileSummary({ file, icon }: { file: StagedFile; icon: ReactNode }) {
  return (
    <span className="recognition-doc-summary">
      <span className="recognition-file-icon">{icon}</span>
      <Typography.Text ellipsis={{ tooltip: file.name }} className="recognition-file-name">
        {file.name}
      </Typography.Text>
      <Typography.Text type="secondary" className="recognition-file-size">
        {formatFileSize(file.size)}
      </Typography.Text>
    </span>
  );
}

export default function RecognitionFilePreview({ file }: { file: StagedFile }) {
  const { message } = App.useApp();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewImages, setPreviewImages] = useState<PdfPreviewPage[]>([]);

  /**
   * 打开 PDF 预览：先开弹层显示"正在生成预览"，再等服务端出图。
   *
   * 失败**不阻断识别**：预览只是"确认传对了文件"的辅助，用户此刻真正要做的是识别，
   * 因为看不了预览就卡住他，是把辅助功能变成了门槛。
   */
  const openPdfPreview = async () => {
    setPreviewImages([]);
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const result = await previewPdf({
        name: file.name,
        mime_type: file.mime_type,
        data: file.data,
        pages: 1,
      });
      setPreviewImages(result.pages);
    } catch {
      setPreviewOpen(false);
      message.error("这个文件预览不了，识别仍可正常使用");
    } finally {
      setPreviewLoading(false);
    }
  };

  if (file.kind === "image" && canPreviewImage(file.mime_type)) {
    return (
      <Tooltip title={file.name}>
        <Image
          src={file.data}
          alt={file.name}
          width={48}
          height={48}
          className="recognition-image"
          // 缩略图要能填满 48×48 的正方形；完整大图交给预览浮层。
          style={{ objectFit: "cover" }}
        />
      </Tooltip>
    );
  }

  if (file.kind === "image") {
    // 浏览器渲染不了的图片（TIFF 等）：不做破图预览，说明一下就好。
    return <FileSummary file={file} icon={<PictureOutlined />} />;
  }

  if (isPdfFile(file)) {
    return (
      <>
        <Space size={6} align="center" className="recognition-file-summary">
          <FilePdfOutlined />
          <Typography.Text ellipsis={{ tooltip: file.name }} className="recognition-file-name">
            {file.name}
          </Typography.Text>
          <Typography.Text type="secondary" className="recognition-file-size">
            {formatFileSize(file.size)}
          </Typography.Text>
          <Button
            type="link"
            size="small"
            aria-label={`预览 ${file.name}`}
            onClick={() => void openPdfPreview()}
          >
            预览
          </Button>
        </Space>
        {/* 弹层宽度自适应：一页 A4 的首页图在 720px 里已经足够看清版式。 */}
        <Modal
          title={`预览 ${file.name}`}
          open={previewOpen}
          footer={null}
          width="min(720px, 92vw)"
          onCancel={() => setPreviewOpen(false)}
          destroyOnHidden
        >
          {previewLoading ? (
            <Typography.Text type="secondary">正在生成预览…</Typography.Text>
          ) : (
            // PreviewGroup 让多页之间可以左右切换并放大（与服务端 `pages` 上限 3 对应）。
            <Image.PreviewGroup>
              {previewImages.map((item) => (
                <Image
                  key={item.page}
                  src={item.image}
                  alt={`第 ${item.page} 页`}
                  width="100%"
                  style={{ display: "block", marginBottom: 8 }}
                />
              ))}
            </Image.PreviewGroup>
          )}
        </Modal>
      </>
    );
  }

  return (
    <Tooltip title="Word 文档不支持浏览器预览，识别时会提取文字">
      <span>
        <FileSummary file={file} icon={<FileWordOutlined />} />
      </span>
    </Tooltip>
  );
}
