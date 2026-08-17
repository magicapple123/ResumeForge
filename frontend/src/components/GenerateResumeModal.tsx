/** AI 生成简历弹窗：风格选择 -> 流式生成 -> 预览结果（自动保存历史）。 */
import { EditOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Modal, Radio, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateResume, renderResume, updateResume } from "../api/resumes";
import { getLLMConfig } from "../api/settings";
import { RESUME_TONES } from "../config";
import type { Job, ResumeContent, ResumeTone, StreamEvent } from "../types";
import ExportButtons from "./ExportButtons";
import ResumeEditorModal from "./ResumeEditorModal";
import ResumePreview from "./ResumePreview";

type Stage = "config" | "generating" | "preview" | "error";

interface Props {
  job: Job | null;
  onClose: () => void;
}

interface GenerateResult {
  resume: ResumeContent;
  warnings: string[];
  recordId: number | null;
}

export default function GenerateResumeModal({ job, onClose }: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>("config");
  const [tone, setTone] = useState<ResumeTone>("standard");
  const [modelName, setModelName] = useState("");
  const [llmReady, setLlmReady] = useState(true);
  const [progress, setProgress] = useState<string[]>([]);
  const [streamText, setStreamText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLDivElement>(null);

  // 打开弹窗时检查 LLM 配置并展示当前模型
  useEffect(() => {
    if (!job) return;
    void getLLMConfig()
      .then((config) => {
        setModelName(config.model || "");
        setLlmReady(!!config.base_url && !!config.model);
      })
      .catch(() => setLlmReady(false));
  }, [job]);

  // 流式文本自动滚到底部
  useEffect(() => {
    if (stage === "generating" && streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight;
    }
  }, [streamText, stage]);

  // 关闭时中止未完成的请求
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    setStage("config");
    setProgress([]);
    setStreamText("");
    setErrorMsg("");
    setResult(null);
    setPreviewHtml("");
    setEditorOpen(false);
  }, []);

  const startGenerate = async () => {
    if (!job) return;
    setStage("generating");
    setProgress([]);
    setStreamText("");
    setErrorMsg("");
    setResult(null);
    setEditorOpen(false);
    abortRef.current = new AbortController();

    // 事件回调里只更新状态；最终结果收集在闭包变量中，流结束后统一处理
    const final: { resume: ResumeContent | null; warnings: string[]; recordId: number | null } = {
      resume: null,
      warnings: [],
      recordId: null,
    };
    const handleEvent = (event: StreamEvent) => {
      switch (event.type) {
        case "progress":
          setProgress((prev) => [...prev, event.message]);
          break;
        case "delta":
          setStreamText((prev) => prev + event.text);
          break;
        case "done":
          final.resume = event.resume;
          final.warnings = event.warnings;
          break;
        case "saved":
          final.recordId = event.record_id;
          break;
        case "error":
          setErrorMsg(event.message);
          break;
      }
    };

    try {
      await generateResume({ job_id: job.id, options: { tone } }, handleEvent, abortRef.current.signal);
      if (final.resume) {
        const html = await renderResume(final.resume);
        setResult({ resume: final.resume, warnings: final.warnings, recordId: final.recordId });
        setPreviewHtml(html);
        setStage("preview");
        message.success("简历已生成并自动保存到简历中心");
      } else {
        setStage("error");
        if (!errorMsg) setErrorMsg("生成失败：未收到有效结果");
      }
    } catch (err) {
      // 用户主动取消不报错
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setStage("error");
        setErrorMsg(err instanceof Error ? err.message : "生成失败，请重试");
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    reset();
    onClose();
  };

  const saveEditedResume = async (content: ResumeContent) => {
    if (!result?.recordId) {
      throw new Error("简历记录尚未保存完成，请稍后再试");
    }
    const updated = await updateResume(result.recordId, content);
    const html = await renderResume(updated.content);
    setResult({ resume: updated.content, warnings: updated.warnings, recordId: updated.id });
    setPreviewHtml(html);
    message.success("简历修改已保存");
  };

  return (
    <Modal
      title={job ? `为「${job.title}」生成简历` : "AI 生成简历"}
      open={!!job}
      onCancel={handleClose}
      width={860}
      footer={null}
      maskClosable={stage !== "generating"}
      closable={stage !== "generating"}
      destroyOnClose
    >
      {stage === "config" && (
        <div>
          {!llmReady ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="尚未配置大模型 API，请先到「设置」页完成配置（支持 DeepSeek / 豆包 / Kimi / OpenAI 等）"
            />
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`当前模型：${modelName || "未知"}。生成过程约需 1-2 分钟，请勿关闭弹窗。`}
              description="系统会根据目标岗位的 JD，从完整个人资料中自动筛选并排序相关经历、项目、校园经历和技能；原始资料不会被修改。"
            />
          )}
          <Typography.Title level={5}>选择定制风格</Typography.Title>
          <Radio.Group
            value={tone}
            onChange={(event) => setTone(event.target.value as ResumeTone)}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {RESUME_TONES.map((item) => (
                <Radio key={item.value} value={item.value}>
                  <Typography.Text strong>{item.label}</Typography.Text>
                  <Typography.Text type="secondary"> - {item.hint}</Typography.Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
          <div style={{ marginTop: 24, textAlign: "right" }}>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" disabled={!llmReady} onClick={() => void startGenerate()}>
                开始生成
              </Button>
            </Space>
          </div>
        </div>
      )}

      {stage === "generating" && (
        <div>
          {progress.map((item, index) => (
            <div key={`${index}-${item}`} style={{ marginBottom: 6 }}>
              <Spin size="small" style={{ marginRight: 8 }} />
              <Typography.Text>{item}</Typography.Text>
            </div>
          ))}
          <div
            ref={streamBoxRef}
            className="stream-text"
            style={{
              marginTop: 12,
              padding: 12,
              background: "#fafafa",
              borderRadius: 6,
              maxHeight: 320,
              overflowY: "auto",
              border: "1px solid #f0f0f0",
            }}
          >
            {streamText || "等待模型输出…"}
          </div>
          <div style={{ marginTop: 16, textAlign: "right" }}>
            <Button danger onClick={handleClose}>
              取消生成
            </Button>
          </div>
        </div>
      )}

      {stage === "preview" && result && (
        <div>
          <ResumePreview html={previewHtml} warnings={result.warnings} />
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space>
              {result.recordId ? (
                <ExportButtons recordId={result.recordId} />
              ) : (
                <Tag color="orange">记录保存中…</Tag>
              )}
            </Space>
            <Space>
              <Button
                icon={<EditOutlined />}
                disabled={!result.recordId}
                onClick={() => setEditorOpen(true)}
              >
                微调内容
              </Button>
              <Button onClick={() => navigate("/resumes")}>去简历中心</Button>
              <Button icon={<ReloadOutlined />} onClick={() => void startGenerate()}>
                重新生成
              </Button>
              <Button type="primary" onClick={handleClose}>
                完成
              </Button>
            </Space>
          </div>
        </div>
      )}

      <ResumeEditorModal
        open={editorOpen}
        content={result?.resume ?? null}
        onClose={() => setEditorOpen(false)}
        onSave={saveEditedResume}
      />

      {stage === "error" && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <Alert type="error" showIcon message={errorMsg || "生成失败"} style={{ marginBottom: 24 }} />
          <Space>
            <Button onClick={reset}>返回重试</Button>
            <Button type="primary" onClick={() => void startGenerate()}>
              重新生成
            </Button>
          </Space>
        </div>
      )}
    </Modal>
  );
}
