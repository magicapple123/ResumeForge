/** 粘贴整段个人资料（或资料截图、简历文档）并结构化识别的弹窗。 */

import { FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Progress, Space, Spin, Typography } from "antd";
import type { StagedFile } from "../../hooks/useRecognitionFiles";
import { MaxLengthHint } from "../common/MaxLengthHint";
import RecognitionFileField from "../RecognitionFileField";
import RecognitionOutcome from "../RecognitionOutcome";
import type { RecognitionSource } from "../../types";

/** 上传阶段在整条进度里占的比例：0-15%，剩下的时间都在解析。 */
const UPLOAD_SHARE_PERCENT = 15;

interface Props {
  open: boolean;
  text: string;
  warnings: string[];
  parsing: boolean;
  /**
   * 附件上传进度（0-100）；null 表示不在上传中。
   *
   * **100 表示字节已经发完**，服务端此时才开始解析、调模型——那一段耗时不可预估，
   * 所以到 100 就切成不确定态（转圈），不再显示百分比。
   */
  uploadPercent: number | null;
  recognizedText: string;
  /** 这次识别是 AI 还是本地规则；还没识别过时为 null。 */
  recognitionSource: RecognitionSource | null;
  files: StagedFile[];
  filesReading: boolean;
  onTextChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: number) => void;
  onPasteFiles: (event: React.ClipboardEvent<HTMLElement>) => void;
  onClose: () => void;
  onParse: () => void;
}

export default function ProfileTextModal({
  open,
  text,
  warnings,
  parsing,
  uploadPercent,
  recognizedText,
  recognitionSource,
  files,
  filesReading,
  onTextChange,
  onAddFiles,
  onRemoveFile,
  onPasteFiles,
  onClose,
  onParse,
}: Props) {
  return (
    <Modal
      title="粘贴个人资料并识别"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={760}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={parsing}>
          关闭
        </Button>,
        <Button
          key="parse"
          type="primary"
          icon={<FileSearchOutlined />}
          loading={parsing}
          onClick={onParse}
        >
          识别并填入
        </Button>,
      ]}
      styles={{ body: { paddingRight: 8 } }}
    >
      <Typography.Paragraph type="secondary">
        可粘贴包含基本信息、教育经历、实习/工作经历、校园经历、项目经历、技能和获奖情况的整段文字，
        也可以贴上这些内容的截图（在下面的输入框里按 Ctrl+V），或者上传简历文档（pdf/docx）。
        文档文字在本机提取，不上传原文件；若已配置大模型，内容会发送到该模型进行
        结构化识别。结果会直接回填当前编辑表单，请核对后再保存。识别图片需要支持图片输入的多模态模型。
      </Typography.Paragraph>
      <Input.TextArea
        aria-label="个人资料文本"
        value={text}
        disabled={parsing}
        onPaste={onPasteFiles}
        onChange={(event) => onTextChange(event.target.value)}
        maxLength={100_000}
        placeholder={
          "例如：\n姓名：张三\n教育经历\n示例大学｜市场营销｜本科｜2022.09-2026.06\n项目经历\n校园招聘会策划｜负责人｜活动策划、渠道对接"
        }
        autoSize={{ minRows: 14, maxRows: 24 }}
      />
      <MaxLengthHint value={text} maxLength={100_000} />
      {/* 文件暂存区紧跟输入框下缘，补 12px 呼吸空隙，避免「添加截图或文档」按钮贴住边框。 */}
      <div style={{ marginTop: 12 }}>
        <RecognitionFileField
          files={files}
          reading={filesReading}
          disabled={parsing}
          onAddFiles={onAddFiles}
          onRemove={onRemoveFile}
        />
      </div>
      <RecognitionOutcome source={recognitionSource} text={recognizedText} />
      {uploadPercent !== null && uploadPercent < 100 && (
        // 上传阶段只占整个等待的一小段：真实字节映射到 0-15%，避免大文件一上传完
        // 进度条就画满、而用户还要再等十几秒解析。
        <Progress
          aria-label="附件上传进度"
          percent={Math.round((uploadPercent / 100) * UPLOAD_SHARE_PERCENT)}
          size="small"
          status="active"
          style={{ marginTop: 12 }}
        />
      )}
      {uploadPercent !== null && uploadPercent >= 100 && parsing && (
        // 解析阶段不显示百分比：服务端要抽文本、可能还要调模型，耗时不可预估。
        // 用不确定态 + 一句说明，比一个停在 15% 的假进度条诚实。
        <Space size={8} style={{ marginTop: 12 }}>
          <Spin size="small" />
          <Typography.Text type="secondary">正在解析资料…</Typography.Text>
        </Space>
      )}
      {warnings.length > 0 && (
        <Alert type="warning" showIcon style={{ marginTop: 12 }} title={warnings.join("；")} />
      )}
    </Modal>
  );
}
