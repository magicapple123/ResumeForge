// SPDX-License-Identifier: Apache-2.0
/** 统一导出面板：格式多选（含照片）+ 水印 + 脱敏。排版设置与页边距都在预览的排版栏（T5）。 */
import { PrinterOutlined } from "@ant-design/icons";
import { Alert, App, Button, Checkbox, Input, Modal, Space, Switch, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { exportResumeWithOptions } from "../api/resumes";
import type { ResumeFontScale, ResumeLanguage } from "../types";
import type { ResumeFormatConfig } from "../types/resumeFormat";
import {
  DEFAULT_REDACTION_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  REDACTION_FIELDS,
  type ExportFormat,
  type ExportRequest,
  type ExportUiFormat,
  type RedactionOptions,
} from "../types/export";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
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
  /**
   * 预览的**草稿语言**（纸面固定文案：小节标题 / 字段前缀）。
   *
   * 与 `initialPageLimit` / `initialFormatConfig` 同源：预览里把语言切成 English、
   * 还没点「保存」时，导出也必须印英文——否则预览是 Summary、下载到的 PDF 是
   * 「个人总结」。不传 = 让后端用记录里存的语言。
   */
  initialLanguage?: ResumeLanguage;
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
  initialLanguage,
  pdfDirectAvailable = true,
  onClose,
}: Props) {
  const { message } = App.useApp();
  // 本面板用模块级 t()：必须订阅语言变化。
  useLocale();
  // 「图片（PNG）」是前端本地格式：它不在后端枚举里，勾选后请求的仍是 PDF。
  const [formats, setFormats] = useState<ExportUiFormat[]>(["pdf"]);
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
   * 用户改完要再回预览确认——排版设置归排版栏，面板归一。
   *
   * **不发 `margin_mm`**（R1）：页边距只有 `format_config.page_padding` 一个落点，
   * 预览与导出读的是同一个键。
   *
   * `language` 同样原样取自预览的草稿（与 `font_scale` / `page_limit` 一致）：它是
   * "导出什么文字"的一部分——漏发它，用户在预览里切到 English 后下载到的仍是中文标题。
   * `null` 表示"不覆盖，用记录里的语言"（旧调用方与未切语言时都是这条）。
   */
  const buildRequest = (format: ExportFormat): ExportRequest => ({
    format,
    watermark: watermarkEnabled ? watermark : "",
    redact,
    redact_options: redact ? redactOptions : undefined,
    font_scale: initialFontScale ?? null,
    page_limit: initialPageLimit ?? null,
    format_config: initialFormatConfig,
    language: initialLanguage ?? null,
    include_photo: includePhoto,
  });

  /**
   * 「还有未完成标记」的就地询问：渲染一条面板内 Alert，用户点按钮才解开 Promise。
   *
   * 为什么不是 `modal.confirm`：导出面板本身就是一个 Modal，叠一个确认框就是第二层容器
   * （3300），焦点与读屏上下文都会跳走。就地 Alert 不改变层级。
   */
  const [incompleteAsk, setIncompleteAsk] = useState<{ message: string } | null>(null);
  // 解开 Promise 的函数放在 ref 里：它只在"事件/异步路径"里读写，不进渲染期
  //（渲染期访问 ref 会被 `react-hooks/refs` 判成错误，也确实说明这里不需要它参与渲染）。
  const incompleteResolve = useRef<((proceed: boolean) => void) | null>(null);

  const askIncomplete = (text: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      incompleteResolve.current = resolve;
      setIncompleteAsk({ message: text });
    });

  const answerIncomplete = (proceed: boolean): void => {
    const resolve = incompleteResolve.current;
    incompleteResolve.current = null;
    setIncompleteAsk(null);
    resolve?.(proceed);
  };

  // 面板被关掉时不能把调用方吊在那个 Promise 上：按"不导出"收尾。
  useEffect(() => {
    return () => {
      incompleteResolve.current?.(false);
      incompleteResolve.current = null;
    };
  }, []);

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
      // 叠层禁令：这一档**不开二次确认弹窗**（那是 3300 的第二层容器），
      // 改成面板内就地一条 Alert，用它的两个按钮把 Promise 解开。
      const proceed = await askIncomplete(err.message);
      if (!proceed) return null;
      return await run(true);
    }
  };

  /**
   * 「图片（PNG）」：**请求的仍是 PDF**（`format: "pdf"`），前端把同一份字节逐页光栅化。
   *
   * 这样图片与用户下载的 PDF 是同一份排版、同一套分页——不会出现"PDF 两页、图片三页"。
   * 单页直接下载 png；多页打成一个 zip（内含 `<主名>-1.png`、`<主名>-2.png`…）。
   *
   * @returns `cancelled` 表示用户在"还有未完成标记"的确认框里选择了先去改简历。
   */
  const exportAsPng = async (): Promise<"done" | "cancelled"> => {
    // 动态引入：pdfjs + worker 加起来 1.5MB，只有真正导出图片时才值得付这份下载量，
    // 不该压在简历详情页的首屏 chunk 上。
    const { runPngExport } = await import("../utils/pngExport");
    const outcome = await runPngExport(() =>
      runExport((allowIncomplete) =>
        exportResumeWithOptions(recordId, {
          ...buildRequest("pdf"),
          allow_incomplete: allowIncomplete || undefined,
        }),
      ),
    );
    if (outcome.status === "cancelled") return "cancelled";

    downloadBlob(outcome.blob, outcome.filename);
    if (outcome.pages > 1) {
      message.info(
        t("exportPanel.toast.packDone", { pages: outcome.pages, filename: outcome.filename }),
      );
    }
    return "done";
  };

  const exportAll = async () => {
    if (formats.length === 0) {
      message.warning(t("exportPanel.toast.needFormat"));
      return;
    }
    if (exporting) return;
    // 图片是从服务端 PDF 转出来的：没有服务端 PDF 就没有图片可转，先别让用户白等。
    if (formats.includes("png") && !pdfDirectAvailable) {
      message.warning(t("exportPanel.font.missingImage"));
      return;
    }
    setExporting(true);
    try {
      for (const format of formats) {
        if (format === "png") {
          if ((await exportAsPng()) === "cancelled") return; // 用户选择先去改简历
          continue;
        }
        const result = await runExport((allowIncomplete) =>
          exportResumeWithOptions(recordId, {
            ...buildRequest(format),
            allow_incomplete: allowIncomplete || undefined,
          }),
        );
        if (result === null) return; // 用户选择先去改简历
        downloadBlob(result.blob, result.filename);
        if (result.savedTo) {
          message.success(t("exportPanel.toast.savedBoth", { path: result.savedTo }));
        }
        if (result.pages && result.pageLimit && result.pages > result.pageLimit) {
          message.warning(
            t("exportPanel.toast.overLimit", {
              format,
              pages: result.pages,
              limit: result.pageLimit,
            }),
          );
        }
      }
      message.success(t("exportPanel.toast.started"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("exportPanel.toast.failed"));
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
          suggestedName: t("exportPanel.fileName", { record: recordId }),
        });
        if (outcome?.saved)
          message.success(t("exportPanel.toast.savedTo", { path: outcome.path ?? "" }));
        return;
      }
      printHtml(html);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("exportPanel.toast.printFailed"));
    }
  };

  return (
    <Modal
      title={t("exportPanel.title")}
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
          {t("exportPanel.action.print")}
        </Button>,
        <Button key="cancel" onClick={onClose}>
          {t("common.action.cancel")}
        </Button>,
        <Button key="ok" type="primary" loading={exporting} onClick={() => void exportAll()}>
          {t("export.action.export")}
        </Button>,
      ]}
    >
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        {incompleteAsk ? (
          <Alert
            type="warning"
            showIcon
            title={t("export.incomplete.title")}
            description={incompleteAsk.message}
            action={
              <Space size={8}>
                <Button size="small" onClick={() => answerIncomplete(false)}>
                  {t("export.incomplete.dismiss")}
                </Button>
                <Button size="small" type="primary" onClick={() => answerIncomplete(true)}>
                  {t("export.incomplete.action")}
                </Button>
              </Space>
            }
          />
        ) : null}
        <div>
          <Typography.Text strong>{t("exportPanel.format.title")}</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Checkbox.Group
              options={EXPORT_FORMAT_OPTIONS.map((item) => ({
                label: t(item.labelKey),
                value: item.value,
              }))}
              value={formats}
              onChange={(values) => setFormats(values as ExportUiFormat[])}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <Space>
              {/* 照片是"导出什么"，不是"长什么样"：它不参与预览渲染，所以归「格式」。 */}
              <Typography.Text>{t("exportPanel.format.includePhoto")}</Typography.Text>
              <Switch
                checked={includePhoto}
                onChange={setIncludePhoto}
                aria-label={t("exportPanel.format.includePhoto")}
              />
            </Space>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("exportPanel.format.pdfNote")}
          </Typography.Text>
          {formats.includes("png") && (
            <div style={{ marginTop: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("exportPanel.format.pngHint")}
                {t("exportPanel.format.pngNote")}
              </Typography.Text>
            </div>
          )}
        </div>

        <div>
          <Space>
            <Typography.Text strong>{t("exportPanel.watermark.title")}</Typography.Text>
            <Switch
              checked={watermarkEnabled}
              onChange={setWatermarkEnabled}
              aria-label={t("exportPanel.watermark.aria")}
            />
          </Space>
          {watermarkEnabled && (
            <Input
              style={{ marginTop: 8 }}
              placeholder={t("exportPanel.watermark.placeholder")}
              value={watermark}
              onChange={(event) => setWatermark(event.target.value)}
            />
          )}
        </div>

        <div>
          <Space>
            <Typography.Text strong>{t("exportPanel.redact.title")}</Typography.Text>
            <Switch
              checked={redact}
              onChange={setRedact}
              aria-label={t("exportPanel.redact.aria")}
            />
          </Space>
          {redact && (
            <div style={{ marginTop: 8 }}>
              <Checkbox.Group
                options={REDACTION_FIELDS.map((item) => ({
                  label: t(item.labelKey),
                  value: item.key,
                }))}
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
            {t("exportPanel.font.missingPdf")}
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}
