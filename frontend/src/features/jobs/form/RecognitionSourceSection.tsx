// SPDX-License-Identifier: Apache-2.0
/** 岗位识别区块：粘贴原文 + 截图/文档上传 + 识别按钮 + 识别结果与警告提示。
 *
 * 纯展示受控组件——识别逻辑（parseImport 防乱序）与文件状态留在 JobFormModal，经回调回传。
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Form } from "antd";
import { useEffect, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { MAX_JOB_TEXT_CHARS } from "../../../config";
import type { StagedFile } from "../../../hooks/useRecognitionFiles";
import type { RecognitionSource } from "../../../types";
import { HintedTextArea } from "../../../components/common/MaxLengthHint";
import RecognitionFileField from "../../profile/fields/RecognitionFileField";
import RecognitionOutcome from "../../profile/fields/RecognitionOutcome";

interface Props {
  rawText: string;
  files: StagedFile[];
  reading: boolean;
  parsing: boolean;
  recognizedText: string;
  recognitionSource: RecognitionSource | null;
  parseWarnings: string[];
  onRawTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onAddFiles: (incoming: File[]) => void;
  onRemoveFile: (id: number) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onParse: () => void;
}

/** 等待期读数：识别一次要 10–30 秒，没有秒数时按钮"像卡住了"（I-35）。 */
function ParseElapsed() {
  const [seconds, setSeconds] = useState(0);
  // 复用已有的「已运行 {seconds} 秒」键：本组件不新增文案，也不动 jobsForm 语言包。
  useLocale();
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="job-parse-elapsed" aria-live="polite">
      {t("backgroundTasks.bar.elapsed", { seconds })}
    </span>
  );
}

export default function RecognitionSourceSection({
  rawText,
  files,
  reading,
  parsing,
  recognizedText,
  recognitionSource,
  parseWarnings,
  onRawTextChange,
  onAddFiles,
  onRemoveFile,
  onPaste,
  onParse,
}: Props) {
  useLocale();
  return (
    <>
      <Form.Item label={t("jobsForm.recognition.label")}>
        {/* HintedTextArea 是 Form.Item 直挂版：注入 value/onChange 的同时顺带渲染
            达上限提示（全仓禁用 antd showCount）。上限与后端解析接口的 50_000 对齐。 */}
        <HintedTextArea
          aria-label={t("jobsForm.recognition.label")}
          value={rawText}
          maxLength={MAX_JOB_TEXT_CHARS}
          disabled={parsing}
          onPaste={onPaste}
          onChange={onRawTextChange}
          placeholder={t("jobsForm.recognition.placeholder")}
          style={{ height: 220, resize: "none" }}
        />
      </Form.Item>
      <RecognitionFileField
        files={files}
        reading={reading}
        disabled={parsing}
        onAddFiles={onAddFiles}
        onRemove={onRemoveFile}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
          marginTop: -12,
          marginBottom: 16,
        }}
      >
        {parsing && <ParseElapsed />}
        <Button type="primary" icon={<FileSearchOutlined />} loading={parsing} onClick={onParse}>
          {t("jobsForm.recognition.submit")}
        </Button>
      </div>
      <RecognitionOutcome source={recognitionSource} text={recognizedText} />
      {parseWarnings.length > 0 && (
        // 一条一行。此前用 `join("；")` 拼成一句，而每条警告自带句号 →
        // 界面上出现「请手动填写。；未识别到…」。也不新增文案 key（jobsForm 域
        // 不在本组可改范围），列表本身说明一切。
        <Alert
          type="warning"
          showIcon
          title={
            <ul className="job-recognition-warnings">
              {parseWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
          style={{ marginBottom: 16 }}
        />
      )}
    </>
  );
}
