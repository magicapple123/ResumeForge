// SPDX-License-Identifier: Apache-2.0
/**
 * 扫描件 OCR 面板（T01/T03）：上传 → 后台任务 → 轮询进度 → 展示正文。
 *
 * 三条交互事实必须如实体现在文案与按钮上：
 * 1. 识别在**服务端后台**进行，关窗口不等于停下；
 * 2. 因此只有「停止等待」（不再轮询），没有「取消识别」——服务端断开也照常计费；
 * 3. 进度是**真实页码**（逐页识别），不是伪进度条。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Modal, Progress, Space, Typography, Upload } from "antd";
import { FileTextOutlined } from "@ant-design/icons";
import { isCancellation } from "../../../api/client";
import { createOcrTask, getOcrTask, type OcrTaskStatus } from "../../../api/ocr";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

const POLL_INTERVAL_MS = 900;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type Phase = "idle" | "uploading" | "recognizing" | "done" | "failed";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ScanOcrModal({ open, onClose }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [task, setTask] = useState<OcrTaskStatus | null>(null);
  const [stopped, setStopped] = useState(false);
  const [failure, setFailure] = useState("");
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setFile(null);
    setPhase("idle");
    setUploadPercent(0);
    setTask(null);
    setStopped(false);
    setFailure("");
  }, [clearTimer]);

  const poll = useCallback((taskId: string) => {
    const tick = async () => {
      try {
        const status = await getOcrTask(taskId);
        if (!alive.current) return;
        setTask(status);
        if (status.status === "running") {
          timer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
          return;
        }
        if (status.status === "succeeded") {
          setPhase("done");
        } else {
          setPhase("failed");
          setFailure(status.error_detail || status.error_code);
        }
      } catch (error) {
        if (!alive.current) return;
        setPhase("failed");
        setFailure(error instanceof Error ? error.message : String(error));
      }
    };
    timer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
  }, []);

  const start = useCallback(async () => {
    if (!file) {
      message.warning(t("ocrScan.noFile"));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      message.error(t("ocrScan.fileTooLarge"));
      return;
    }
    setPhase("uploading");
    setUploadPercent(0);
    setTask(null);
    setStopped(false);
    setFailure("");
    try {
      const created = await createOcrTask(file, { onProgress: setUploadPercent });
      setPhase("recognizing");
      poll(created.task_id);
    } catch (error) {
      setPhase("failed");
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, [file, message, poll]);

  const stopWaiting = useCallback(() => {
    clearTimer();
    setStopped(true);
  }, [clearTimer]);

  const close = useCallback(() => {
    clearTimer();
    onClose();
  }, [clearTimer, onClose]);

  const done = task?.pages_done ?? 0;
  const total = task?.total_pages ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const busy = phase === "uploading" || phase === "recognizing";

  return (
    <Modal
      open={open}
      title={t("ocrScan.title")}
      onCancel={close}
      afterClose={reset}
      width={720}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={close}>{t("ocrScan.close")}</Button>
          {phase === "recognizing" && !stopped ? (
            <Button danger onClick={stopWaiting}>
              {t("ocrScan.stopWaiting")}
            </Button>
          ) : null}
          <Button type="primary" loading={busy} disabled={busy || !file} onClick={start}>
            {t("ocrScan.start")}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("ocrScan.hint")}
        </Typography.Paragraph>

        <Space wrap>
          <Upload
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            maxCount={1}
            showUploadList={false}
            disabled={busy}
            beforeUpload={(picked) => {
              setFile(picked as File);
              setPhase("idle");
              setTask(null);
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<FileTextOutlined />} disabled={busy}>
              {t("ocrScan.pickFile")}
            </Button>
          </Upload>
          <Typography.Text>{file ? file.name : "—"}</Typography.Text>
        </Space>

        {phase === "uploading" ? (
          <div>
            <Typography.Text type="secondary">{t("ocrScan.uploading")}</Typography.Text>
            <Progress percent={uploadPercent} size="small" />
          </div>
        ) : null}

        {task ? (
          <div>
            <Typography.Text>
              {phase === "recognizing" || phase === "done"
                ? t("ocrScan.pages", { done, total })
                : ""}
            </Typography.Text>
            <Progress
              percent={percent}
              status={phase === "failed" ? "exception" : phase === "done" ? "success" : "active"}
            />
            <Typography.Text type="secondary">
              {t("ocrScan.elapsed", { seconds: Math.round((task.elapsed_ms ?? 0) / 1000) })}
            </Typography.Text>
          </div>
        ) : null}

        {stopped ? (
          <Alert
            type="warning"
            showIcon
            title={t("ocrScan.stopped")}
            description={t("ocrScan.stopNote")}
          />
        ) : (
          <Typography.Text type="secondary">{t("ocrScan.stopNote")}</Typography.Text>
        )}

        {phase === "failed" ? (
          <Alert type="error" showIcon title={t("ocrScan.failed", { reason: failure })} />
        ) : null}

        {phase === "done" && task ? (
          <div>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text strong>{t("ocrScan.resultTitle")}</Typography.Text>
              <Space>
                <Typography.Text type="secondary">
                  {t("ocrScan.chars", { count: task.text.length })}
                </Typography.Text>
                <Button
                  size="small"
                  onClick={async () => {
                    await navigator.clipboard.writeText(task.text);
                    message.success(t("ocrScan.copied"));
                  }}
                >
                  {t("ocrScan.copy")}
                </Button>
              </Space>
            </Space>
            <Typography.Paragraph
              style={{ maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", marginTop: 8 }}
              data-testid="scan-ocr-text"
            >
              {task.text || t("ocrScan.emptyResult")}
            </Typography.Paragraph>
            {task.warnings.map((warning) => (
              <Typography.Text key={warning} type="secondary" style={{ display: "block" }}>
                {warning}
              </Typography.Text>
            ))}
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}

/** 供调用方复用的取消判定：用户自己关窗口不算失败。 */
export const isScanOcrCancellation = isCancellation;
