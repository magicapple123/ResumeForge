// SPDX-License-Identifier: Apache-2.0
/** 岗位识别区块：粘贴原文 + 截图/文档上传 + 识别按钮 + 识别结果与警告提示。
 *
 * 纯展示受控组件——识别逻辑（parseImport 防乱序）与文件状态留在 JobFormModal，经回调回传。
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Form } from "antd";
import type { ChangeEvent, ClipboardEvent } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { MAX_JOB_TEXT_CHARS } from "../../../config";
import type { StagedFile } from "../../../hooks/useRecognitionFiles";
import type { RecognitionSource } from "../../../types";
import { HintedTextArea } from "../../common/MaxLengthHint";
import RecognitionFileField from "../../RecognitionFileField";
import RecognitionOutcome from "../../RecognitionOutcome";

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
          marginTop: -12,
          marginBottom: 16,
        }}
      >
        <Button type="primary" icon={<FileSearchOutlined />} loading={parsing} onClick={onParse}>
          {t("jobsForm.recognition.submit")}
        </Button>
      </div>
      <RecognitionOutcome source={recognitionSource} text={recognizedText} />
      {parseWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={parseWarnings.join(t("jobsForm.recognition.warningSeparator"))}
          style={{ marginBottom: 16 }}
        />
      )}
    </>
  );
}
