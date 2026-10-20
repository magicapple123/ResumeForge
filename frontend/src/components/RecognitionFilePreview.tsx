/**
 * 识别前暂存文件的**预览**（T6）：预览的是上传的文件本身，不是识别结果。
 *
 * 三种形态：
 * - 图片：48×48 缩略图。同一次暂存的多张图由调用方包在 `Image.PreviewGroup` 里，
 *   点开可以左右切换/缩放（这里只管画自己那一个）。
 * - PDF：交给浏览器内置阅读器（`window.open` 打开 base64 data URL）。刻意不自己渲染——
 *   自建 PDF 渲染器要额外几百 KB，而每个现代浏览器都已内置一个。
 * - docx：浏览器没有原生渲染能力，只能说明"识别时会提取文字"，不给预览按钮——
 *   给一个点了会下载/报错的按钮比没有按钮更糟。
 */
import { FilePdfOutlined, FileWordOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Image, Space, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
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
    <Space size={6} align="center" className="recognition-file-summary">
      {icon}
      <Typography.Text ellipsis={{ tooltip: file.name }} className="recognition-file-name">
        {file.name}
      </Typography.Text>
      <Typography.Text type="secondary" className="recognition-file-size">
        {formatFileSize(file.size)}
      </Typography.Text>
    </Space>
  );
}

export default function RecognitionFilePreview({ file }: { file: StagedFile }) {
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
          onClick={() => window.open(file.data, "_blank", "noopener,noreferrer")}
        >
          预览
        </Button>
      </Space>
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
