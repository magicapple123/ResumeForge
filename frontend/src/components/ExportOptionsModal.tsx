// SPDX-License-Identifier: Apache-2.0
/** 统一导出面板：格式多选（含照片）+ 水印 + 脱敏。版式与页边距在预览的版式栏（T5）。 */
import { PrinterOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal, Space, Switch, Typography } from "antd";
import { useState } from "react";
import { ApiError } from "../api/client";
import { exportResumeWithOptions } from "../api/resumes";
import type { ResumeFontScale } from "../types";
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

interface Props {
  recordId: number;
  open: boolean;
  /** 预览当前使用的页数上限；不传则让后端按记录里存的版式决定。 */
  initialPageLimit?: number;
  /** 预览当前使用的字号档位（草稿，可能尚未保存）。 */
  initialFontScale?: ResumeFontScale;
  /**
   * 预览当前使用的版式草稿（字号系数 / 行距 / 页边距 / 区块间距…），**原样透传**。
   *
   * T5 起面板不再改版式：这份草稿就是导出的版式，不带（或只带一部分）会导出成记录里
   * 存的旧版式——那正是"预览一页、导出两页"的来源。
   */
  initialFormatConfig?: ResumeFormatConfig;
  /** 服务端是否找到中文字体；为 false 时只有浏览器打印一条路。 */
  pdfDirectAvailable?: boolean;
  onClose: () => void;
}

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
  const [includePhoto, setIncludePhoto] = useState(true);
  const [exporting, setExporting] = useState(false);

  /**
   * 组装一次导出请求（T5）。
   *
   * 面板**只管导出选项**（格式 / 水印 / 脱敏 / 照片）：字号、页数、页边距全部原样取自
   * 预览的版式草稿。以前面板还能覆盖这三项，结果是"面板 14mm、预览 11mm"两套数字，
   * 用户改完要再回预览确认——版式归版式栏，面板归一。
   *
   * **不发 `margin_mm`**（R1）：页边距只有 `format_config.page_padding` 一个落点，
   * 预览与导出读的是同一个键。
   */
  const buildRequest = (format: ExportFormat): ExportRequest => ({
    format,
    watermark: watermarkEnabled ? watermark : "",
    redact,
    redact_options: redact ? redactOptions : undefined,
    font_scale: initialFontScale ?? null,
    page_limit: initialPageLimit ?? null,
    format_config: initialFormatConfig,
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

  return (
    <Modal
      title="导出"
      open={open}
      onCancel={onClose}
      width="min(520px, 92vw)"
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
          <div style={{ marginTop: 8 }}>
            <Space>
              {/* 照片是"导出什么"，不是"长什么样"：它不参与预览渲染，所以归「格式」。 */}
              <Typography.Text>包含照片</Typography.Text>
              <Switch checked={includePhoto} onChange={setIncludePhoto} aria-label="包含照片" />
            </Space>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            PDF 与 Word 由服务端排版引擎生成，保证文字可提取；自编 HTML 的复杂版式请在浏览器中打开
            HTML 文件后打印导出。
          </Typography.Text>
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
