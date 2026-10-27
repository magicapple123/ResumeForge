// SPDX-License-Identifier: Apache-2.0
/**
 * 从通知内容导入进度：粘贴/截图 → 识别预览 → 勾选确认 → 写入。
 *
 * 预览这一步不是走过场：面板上每条都写明"会新增 / 会更新 / 没变化"和原因，用户看的是
 * **会发生什么**，而不是一堆等他自己判断的字段。取消或关闭都不会写任何数据。
 */
import { App, Button, Checkbox, Input, Modal, Space, Tag, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { useEffect, useState } from "react";
import { applyTracks, parseTracks } from "../../api/tracker";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { MERGE_ACTION_LABEL_KEYS, TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import { useRecognitionFiles } from "../../hooks/useRecognitionFiles";
import RecognitionFileField from "../RecognitionFileField";
import type { TrackMergePreview, TrackRecord } from "../../types";
import { MERGE_ACTION_COLORS } from "../../types";

interface Row {
  key: number;
  checked: boolean;
  preview: TrackMergePreview;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function TrackImportModal({ open, onClose, onImported }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [engine, setEngine] = useState<"ai" | "local" | "">("");
  const [busy, setBusy] = useState(false);
  const { files, reading, addFiles, removeFile, clear, onPaste } = useRecognitionFiles();

  // 关闭时清空：否则下次打开会看到上一次的内容和预览，容易误以为已经保存过了。
  // Compiler 规范：状态重置用渲染期守卫；clear() 外部 store 副作用留在 effect。
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setText("");
      setRows([]);
      setNotes([]);
      setEngine("");
    }
  }

  useEffect(() => {
    if (!open) clear();
  }, [open, clear]);

  const recognize = async () => {
    if (!text.trim() && files.length === 0) {
      message.warning(t("trackerImport.toast.noInput"));
      return;
    }
    setBusy(true);
    try {
      const result = await parseTracks({
        text,
        images: files
          .filter((file) => file.kind === "image")
          .map(({ name, mime_type, data }) => ({ name, mime_type, data })),
        documents: files
          .filter((file) => file.kind === "document")
          .map(({ name, mime_type, data }) => ({ name, mime_type, data })),
      });
      setRows(result.items.map((preview, index) => ({ key: index, checked: true, preview })));
      setNotes(result.notes);
      setEngine(result.parse_engine);
      if (result.items.length === 0) message.info(t("trackerImport.toast.noRecords"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("trackerImport.toast.recognizeFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const picked = rows.filter((row) => row.checked).map((row) => row.preview.record);
    if (picked.length === 0) {
      message.warning(t("trackerImport.toast.noneSelected"));
      return;
    }
    setBusy(true);
    try {
      const result = await applyTracks(picked as TrackRecord[]);
      // 如实分别报出三种结果：全都说成"已保存"会让用户以为进度确实更新了。
      const parts = [
        result.created ? t("trackerImport.result.created", { count: result.created }) : "",
        result.updated ? t("trackerImport.result.updated", { count: result.updated }) : "",
        result.unchanged ? t("trackerImport.result.unchanged", { count: result.unchanged }) : "",
      ].filter(Boolean);
      message.success(
        parts.join(t("trackerImport.result.separator")) || t("trackerImport.result.done"),
      );
      onImported();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("trackerImport.toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("trackerImport.dialog.title")}
      width={780}
      // 识别出的通知条数不固定：限高让超长列表只滚弹窗内部。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{t("common.action.cancel")}</Button>
          {rows.length > 0 && (
            <Button type="primary" loading={busy} onClick={() => void confirm()}>
              {t("trackerImport.action.confirm", {
                count: rows.filter((row) => row.checked).length,
              })}
            </Button>
          )}
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">{t("trackerImport.dialog.intro")}</Typography.Text>
        <Input.TextArea
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={onPaste}
          placeholder={t("trackerImport.dialog.placeholder")}
          disabled={busy}
        />
        <RecognitionFileField
          files={files}
          reading={reading}
          disabled={busy}
          onAddFiles={(incoming) => void addFiles(incoming)}
          onRemove={removeFile}
        />
        <Space>
          <Button type="primary" loading={busy} onClick={() => void recognize()}>
            {t("trackerImport.action.recognize")}
          </Button>
          {engine && (
            <Tag color={engine === "ai" ? "blue" : "default"}>
              {engine === "ai" ? t("trackerImport.engine.ai") : t("trackerImport.engine.local")}
            </Tag>
          )}
        </Space>

        {notes.map((note) => (
          <Typography.Text key={note} type="secondary" className="track-import-note">
            · {note}
          </Typography.Text>
        ))}

        {rows.length === 0 ? (
          <EmptyState inline description={t("trackerImport.empty.noResults")} />
        ) : (
          <div className="track-import-list">
            {rows.map((row) => (
              <div key={row.key} className="track-import-row">
                <Checkbox
                  checked={row.checked}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item) =>
                        item.key === row.key ? { ...item, checked: event.target.checked } : item,
                      ),
                    )
                  }
                />
                <div className="track-import-fields">
                  <Space size={6} wrap>
                    <Typography.Text strong>{row.preview.record.company}</Typography.Text>
                    <Typography.Text type="secondary">{row.preview.record.title}</Typography.Text>
                    <Tag color={MERGE_ACTION_COLORS[row.preview.action]}>
                      {t(MERGE_ACTION_LABEL_KEYS[row.preview.action])}
                    </Tag>
                    <Tag>{t(TRACK_STATUS_LABEL_KEYS[row.preview.record.status])}</Tag>
                  </Space>
                  {/* 原因比结论更重要：用户据此判断这条该不该勾。 */}
                  <Typography.Text type="secondary" className="track-import-reason">
                    {row.preview.reason}
                  </Typography.Text>
                  {row.preview.record.evidence && (
                    <Typography.Text type="secondary" className="track-import-evidence">
                      {t("trackerImport.evidence.label", { evidence: row.preview.record.evidence })}
                    </Typography.Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Space>
    </Modal>
  );
}
