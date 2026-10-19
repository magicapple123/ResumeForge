/** 统一导出面板：格式多选 + 版式（页数/字号/行距）+ 水印 + 脱敏（含预览）+ 照片。 */
import { PrinterOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";
import { ApiError } from "../api/client";
import { exportResumeWithOptions, redactResume } from "../api/resumes";
import type { ResumeContent, ResumeFontScale } from "../types";
import type { ResumeFormatConfig } from "../types/resumeFormat";
import {
  DEFAULT_REDACTION_OPTIONS,
  EXPORT_FORMATS,
  REDACTION_FIELDS,
  type ExportFormat,
  type ExportRequest,
  type RedactionOptions,
} from "../types/export";
import { downloadBlob, printHtml } from "../utils/download";
import { MAX_PAGE_PADDING, MIN_PAGE_PADDING, withPagePadding } from "../utils/pagePadding";

interface Props {
  recordId: number;
  open: boolean;
  /** 预览当前使用的页数上限；不传则让后端按记录里存的版式决定。 */
  initialPageLimit?: number;
  /** 预览当前使用的字号档位（草稿，可能尚未保存）。 */
  initialFontScale?: ResumeFontScale;
  /**
   * 预览当前使用的版式草稿（字号系数 / 行距 / 页边距 / 区块间距…）。
   *
   * **必须带上**：面板里的"留空沿用记录"只适用于面板自己能改的三项；字号系数与行距
   * 是预览独有的草稿值，不带就会导出成记录里的旧版式（预览一页、导出两页）。
   */
  initialFormatConfig?: ResumeFormatConfig;
  /** 服务端是否找到中文字体；为 false 时只有浏览器打印一条路。 */
  pdfDirectAvailable?: boolean;
  onClose: () => void;
}

const FONT_SCALE_OPTIONS: { value: ResumeFontScale; label: string }[] = [
  { value: "small", label: "小字号" },
  { value: "standard", label: "标准字号" },
  { value: "large", label: "大字号" },
];

const PAGE_LIMIT_OPTIONS = [
  { value: 1, label: "1 页" },
  { value: 2, label: "2 页" },
  { value: 3, label: "3 页" },
];

export default function ExportOptionsModal({
  recordId,
  open,
  initialPageLimit,
  initialFontScale,
  initialFormatConfig,
  pdfDirectAvailable = true,
  onClose,
}: Props) {
  const { message, modal } = App.useApp();
  const [formats, setFormats] = useState<ExportFormat[]>(["pdf"]);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermark, setWatermark] = useState("");
  const [redact, setRedact] = useState(false);
  const [redactOptions, setRedactOptions] = useState<RedactionOptions>(DEFAULT_REDACTION_OPTIONS);
  const [redactedPreview, setRedactedPreview] = useState<ResumeContent | null>(null);
  // 页边距初值取预览当前用的那一档（`format_config.page_padding`），面板与预览因此是
  // 同一个数字，而不是"面板 14mm、预览 11mm"两套。
  const [pagePadding, setPagePadding] = useState<number | null>(
    typeof initialFormatConfig?.page_padding === "number" ? initialFormatConfig.page_padding : null,
  );
  const [fontScale, setFontScale] = useState<ResumeFontScale | null>(initialFontScale ?? null);
  // 初值取"预览当前用的页数"，而不是 null（null 会被后端解释成"按记录里存的那份版式"）。
  // 用户在预览里改过页数、还没保存就导出时，null 会导出一份与眼前所见不同页数的文件——
  // 这正是"预览 2 页、导出 1 页"的来源。
  const [pageLimit, setPageLimit] = useState<number | null>(initialPageLimit ?? null);
  const [includePhoto, setIncludePhoto] = useState(true);
  const [exporting, setExporting] = useState(false);

  /** 当前行距（只读展示）：值来自预览的版式草稿，导出时原样带上。 */
  const currentLineHeight =
    typeof initialFormatConfig?.line_height === "number" ? initialFormatConfig.line_height : null;
  const currentFontAdjust =
    typeof initialFormatConfig?.font_scale_adjust === "number"
      ? initialFormatConfig.font_scale_adjust
      : null;

  /**
   * 组装一次导出请求。所有字段共用同一份草稿版式——面板改的三项覆盖在它之上，
   * 面板没碰的（字号系数 / 行距 / 区块间距 / 强调色）原样透传给后端。
   *
   * **不再发 `margin_mm`**（R1）：页边距只有 `format_config.page_padding` 一个落点，
   * 预览与导出读的是同一个键。两套参数并存的代价是"预览不变、导出变了"。
   */
  const buildRequest = (format: ExportFormat): ExportRequest => ({
    format,
    watermark: watermarkEnabled ? watermark : "",
    redact,
    redact_options: redact ? redactOptions : undefined,
    // 面板清空时回落到预览的档位：记录里的档位可能和眼前所见不是同一个。
    font_scale: fontScale ?? initialFontScale ?? null,
    page_limit: pageLimit,
    format_config: withPagePadding(initialFormatConfig, pagePadding),
    include_photo: includePhoto,
  });

  /**
   * 导出被「正文还有未完成标记」拦下时（409），问一次是否仍要导草稿。
   *
   * 拦下不等于堵死：用户确实只想导一份草稿自查时得有出路。所有格式共用这一个包装，
   * 因为四种格式都会撞到这条闸门——各写一遍迟早漏掉一个。
   */
  const runExport = async <T,>(
    run: (allowIncomplete: boolean) => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await run(false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;
      const proceed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "简历里还有未完成标记",
          content: err.message,
          okText: "仍要导出草稿",
          cancelText: "我去改简历",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return null;
      return await run(true);
    }
  };

  const exportAll = async () => {
    if (formats.length === 0) {
      message.warning("请至少选择一种导出格式");
      return;
    }
    if (exporting) return;
    setExporting(true);
    try {
      for (const format of formats) {
        const result = await runExport((allowIncomplete) =>
          exportResumeWithOptions(recordId, {
            ...buildRequest(format),
            allow_incomplete: allowIncomplete || undefined,
          }),
        );
        if (result === null) return; // 用户选择先去改简历
        downloadBlob(result.blob, result.filename);
        if (result.savedTo) {
          message.success(`已同时保存到 ${result.savedTo}`);
        }
        if (result.pages && result.pageLimit && result.pages > result.pageLimit) {
          message.warning(
            `「${format}」共 ${result.pages} 页，超过所选 ${result.pageLimit} 页上限。`,
          );
        }
      }
      message.success("已开始导出");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  /** 浏览器打印：与预览同一份 HTML（含草稿版式），打印页数由浏览器决定。 */
  const printResume = async () => {
    try {
      const result = await runExport((allowIncomplete) =>
        exportResumeWithOptions(recordId, {
          ...buildRequest("html"),
          allow_incomplete: allowIncomplete || undefined,
        }),
      );
      if (result === null) return;
      const html = await result.blob.text();
      // R1：桌面版直接把这份 HTML 交给 Chromium 打印——和预览同一个引擎，
      // 分页与行距才对得上；浏览器里没有这个桥，继续走 window.print。
      const desktopPrint = window.resumeForge?.printPdf;
      if (desktopPrint) {
        const outcome = await desktopPrint({
          html,
          suggestedName: `${recordId}-简历.pdf`,
        });
        if (outcome?.saved) message.success(`已保存到 ${outcome.path}`);
        return;
      }
      printHtml(html);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "打开打印窗口失败");
    }
  };

  /** 脱敏预览：调后端同一套规则（`privacy.redact` 唯一实现），只显示页眉三项。 */
  const previewRedaction = async () => {
    try {
      setRedactedPreview(await redactResume(recordId, redactOptions));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "脱敏预览失败");
    }
  };

  return (
    <Modal
      title="导出"
      open={open}
      onCancel={onClose}
      width="min(560px, 92vw)"
      destroyOnHidden
      footer={[
        <Button
          key="print"
          type="text"
          icon={<PrinterOutlined />}
          onClick={() => void printResume()}
        >
          浏览器打印
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" loading={exporting} onClick={() => void exportAll()}>
          导出
        </Button>,
      ]}
    >
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Typography.Text strong>格式</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Checkbox.Group
              options={EXPORT_FORMATS.map((item) => ({ label: item.label, value: item.value }))}
              value={formats}
              onChange={(values) => setFormats(values as ExportFormat[])}
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            PDF 与 Word 由服务端排版引擎生成，保证文字可提取；自编 HTML 的复杂版式请在浏览器中打开
            HTML 文件后打印导出。
          </Typography.Text>
        </div>

        <div>
          <Typography.Text strong>版式</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              <span>页数</span>
              <Select
                allowClear
                placeholder="跟记录"
                style={{ width: 90 }}
                value={pageLimit}
                options={PAGE_LIMIT_OPTIONS}
                onChange={(value) => setPageLimit((value as number | null) ?? null)}
              />
              <span>字号</span>
              <Select
                allowClear
                placeholder="跟记录"
                style={{ width: 110 }}
                value={fontScale}
                options={FONT_SCALE_OPTIONS}
                onChange={(value) => setFontScale((value as ResumeFontScale | null) ?? null)}
              />
              <span>页边距(mm，与预览一致)</span>
              <InputNumber
                min={MIN_PAGE_PADDING}
                max={MAX_PAGE_PADDING}
                step={1}
                placeholder="跟预览"
                style={{ width: 90 }}
                value={pagePadding}
                onChange={(value) => setPagePadding(value)}
              />
            </Space>
          </div>
          {(currentLineHeight !== null || currentFontAdjust !== null) && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              跟随预览：
              {currentLineHeight !== null ? `行距 ${currentLineHeight.toFixed(2)}` : ""}
              {currentLineHeight !== null && currentFontAdjust !== null ? " · " : ""}
              {currentFontAdjust !== null ? `字号系数 ${currentFontAdjust.toFixed(2)}` : ""}
            </Typography.Text>
          )}
          <div style={{ marginTop: 8 }}>
            <Space>
              <Typography.Text>显示照片</Typography.Text>
              <Switch checked={includePhoto} onChange={setIncludePhoto} aria-label="显示照片" />
            </Space>
          </div>
        </div>

        <div>
          <Space>
            <Typography.Text strong>水印</Typography.Text>
            <Switch
              checked={watermarkEnabled}
              onChange={setWatermarkEnabled}
              aria-label="开启水印"
            />
          </Space>
          {watermarkEnabled && (
            <Input
              style={{ marginTop: 8 }}
              placeholder="水印文案，例如：内部使用"
              value={watermark}
              onChange={(event) => setWatermark(event.target.value)}
            />
          )}
        </div>

        <div>
          <Space>
            <Typography.Text strong>脱敏</Typography.Text>
            <Switch checked={redact} onChange={setRedact} aria-label="开启脱敏" />
            {redact && (
              <Button type="link" size="small" onClick={() => void previewRedaction()}>
                预览脱敏效果
              </Button>
            )}
          </Space>
          {redact && (
            <div style={{ marginTop: 8 }}>
              <Checkbox.Group
                options={REDACTION_FIELDS.map((item) => ({ label: item.label, value: item.key }))}
                value={REDACTION_FIELDS.filter((item) => redactOptions[item.key]).map(
                  (item) => item.key,
                )}
                onChange={(values) => {
                  const selected = values as (keyof RedactionOptions)[];
                  const next = {} as RedactionOptions;
                  for (const field of REDACTION_FIELDS) {
                    next[field.key] = selected.includes(field.key);
                  }
                  setRedactOptions(next);
                }}
              />
              {redactedPreview && (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                  预览：{redactedPreview.name} · {redactedPreview.phone} · {redactedPreview.email}
                </Typography.Paragraph>
              )}
            </div>
          )}
        </div>

        {!pdfDirectAvailable && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            系统里没有找到中文字体，PDF 需要走「浏览器打印」生成。
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}
