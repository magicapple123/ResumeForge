/** 岗位识别区块：粘贴原文 + 截图/文档上传 + 识别按钮 + 识别结果与警告提示。
 *
 * 纯展示受控组件——识别逻辑（parseImport 防乱序）与文件状态留在 JobFormModal，经回调回传。
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input } from "antd";
import type { ChangeEvent, ClipboardEvent } from "react";
import type { StagedFile } from "../../../hooks/useRecognitionFiles";
import type { RecognitionSource } from "../../../types";
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
  return (
    <>
      <Form.Item label="完整招聘信息">
        <Input.TextArea
          aria-label="完整招聘信息"
          value={rawText}
          disabled={parsing}
          onPaste={onPaste}
          onChange={onRawTextChange}
          placeholder="粘贴职位名称、地点、职位描述、职位要求等完整招聘信息，或按 Ctrl+V 直接贴招聘截图（也可以上传 pdf/docx 招聘文档）"
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
        <Button
          type="primary"
          icon={<FileSearchOutlined />}
          loading={parsing}
          onClick={onParse}
        >
          识别并填充
        </Button>
      </div>
      <RecognitionOutcome source={recognitionSource} text={recognizedText} />
      {parseWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={parseWarnings.join("；")}
          style={{ marginBottom: 16 }}
        />
      )}
    </>
  );
}
