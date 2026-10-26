// SPDX-License-Identifier: Apache-2.0
/** 简历写作增强面板：STAR 改写 / 话术生成 / 风格润色 / 中英互译。
 *
 * 自包含：一段文本进、一段文本出。
 *
 * **结果默认回填**（2026-10-24 最终口径）：面板现在是从**右键菜单**打开的弹窗，入参就是
 * 用户刚选中的那一段，`onApply` 由宿主直接写回那个选区——所见即所得，不用再复制粘贴。
 * 没有可写目标时（右键落在普通段落上）宿主不传 `onApply`，面板退回「复制」，
 * 因为那种情况下"回填到哪里"根本没有答案，按钮点下去只会静默失败。
 */
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Alert, App, Button, Checkbox, Input, Radio, Segmented, Space, Typography } from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useMemo, useState } from "react";
import {
  generatePhrases,
  polishResumeText,
  rewriteStar,
  translateResumeText,
} from "../api/resumeWriting";
import { t, type MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import type {
  PhraseMode,
  PhrasesResult,
  PolishStyle,
  TranslateDirection,
} from "../types/resumeWriting";
import { copyText } from "../utils/clipboard";

type Operation = "star" | "phrases" | "polish" | "translate";

const OPERATIONS: { value: Operation; label: string }[] = [
  { value: "star", label: "STAR 改写" },
  { value: "phrases", label: "话术生成" },
  { value: "polish", label: "风格润色" },
  { value: "translate", label: "中英互译" },
];

/**
 * 每个动作**一句话**的用途说明（2026-10-24 用户口径："功能不太明确"）。
 *
 * 放在动作选择器**下面**随选中项切换，而不是写成一段总说明：用户此刻只关心
 * "我选的这个动作会怎么改我的句子"。文案说"改什么"，不说"用了什么模型"。
 */
const OPERATION_HINTS: Record<Operation, MessageKey> = {
  star: "writing.hint.star",
  phrases: "writing.hint.phrases",
  polish: "writing.hint.polish",
  translate: "writing.hint.translate",
};

const POLISH_STYLES: { value: PolishStyle; label: string }[] = [
  { value: "big_tech", label: "大厂风" },
  { value: "concise_tech", label: "简洁干练风" },
  { value: "campus", label: "应届生风" },
];

const PHRASE_MODES: { value: PhraseMode; label: string }[] = [
  { value: "star", label: "STAR 版" },
  { value: "resume", label: "简历版" },
  { value: "interview", label: "面试口述版" },
];

interface Props {
  resumeId: number;
  initialText?: string;
  /**
   * 把结果写回宿主指定的位置（右键时选中的那段文字）。
   *
   * 缺省 = 没有可写目标，结果块显示「复制」而不是「回填」。
   */
  onApply?: (result: string) => boolean | void;
}

export default function ResumeWritingPanel({ resumeId, initialText = "", onApply }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [text, setText] = useState(initialText);
  const [operation, setOperation] = useState<Operation>("star");
  const [polishStyle, setPolishStyle] = useState<PolishStyle>("concise_tech");
  const [direction, setDirection] = useState<TranslateDirection>("zh2en");
  const [modes, setModes] = useState<PhraseMode[]>(["star", "resume", "interview"]);
  const [loading, setLoading] = useState(false);
  const [singleResult, setSingleResult] = useState("");
  const [phrasesResult, setPhrasesResult] = useState<PhrasesResult | null>(null);

  const canRun = useMemo(() => text.trim().length > 0, [text]);

  const run = async () => {
    if (!canRun || loading) return;
    setLoading(true);
    setSingleResult("");
    setPhrasesResult(null);
    try {
      if (operation === "star") {
        setSingleResult((await rewriteStar(resumeId, text.trim())).result);
      } else if (operation === "phrases") {
        setPhrasesResult(await generatePhrases(resumeId, text.trim(), modes));
      } else if (operation === "polish") {
        setSingleResult((await polishResumeText(resumeId, text.trim(), polishStyle)).result);
      } else {
        setSingleResult((await translateResumeText(resumeId, text.trim(), direction)).result);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  /**
   * 回填：交给宿主写回选区（选区偏移由它记着），这里只负责给反馈。
   *
   * 宿主返回 `false` 表示没写进去（选区已失效、超出 `maxLength`）——这时不能说"已回填"，
   * 否则用户会以为正文改好了、其实一个字没动。
   */
  const apply = (result: string) => {
    if (!result || !onApply) return;
    const applied = onApply(result);
    if (applied === false) message.warning(t("writing.apply.failed"));
    else message.success(t("writing.apply.success"));
  };

  const copy = async (result: string) => {
    if (!result) return;
    const ok = await copyText(result);
    if (ok) message.success(t("writing.copy.success"));
    else message.warning(t("writing.copy.failed"));
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      {/* 用法提示（2026-10-24 用户口径："功能不太明确"）：三件事说清——贴什么、
          选什么、结果去哪。常驻而不是一次性引导：这几个动作对应的是不同场景，
          用户是"想不起来该选哪个"时才回来看，藏起来等于没写。 */}
      <Alert
        type="info"
        showIcon
        className="resume-writing-hint"
        title={t("writing.hint.title")}
        description={t("writing.hint.body")}
      />
      <Input.TextArea
        rows={4}
        value={text}
        placeholder="粘贴或输入一段简历描述"
        onChange={(event) => setText(event.target.value)}
        aria-label="写作输入文本"
      />

      <Segmented
        block
        options={OPERATIONS}
        value={operation}
        onChange={(value) => setOperation(value as Operation)}
      />

      <Typography.Text type="secondary" className="resume-writing-hint-line">
        {t(OPERATION_HINTS[operation])}
      </Typography.Text>

      {operation === "polish" && (
        <Radio.Group
          value={polishStyle}
          onChange={(event) => setPolishStyle(event.target.value)}
          aria-label="润色风格"
        >
          {POLISH_STYLES.map((item) => (
            <Radio.Button key={item.value} value={item.value}>
              {item.label}
            </Radio.Button>
          ))}
        </Radio.Group>
      )}

      {operation === "translate" && (
        <Radio.Group
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          aria-label="翻译方向"
        >
          <Radio.Button value="zh2en">中译英</Radio.Button>
          <Radio.Button value="en2zh">英译中</Radio.Button>
        </Radio.Group>
      )}

      {operation === "phrases" && (
        <Checkbox.Group
          options={PHRASE_MODES}
          value={modes}
          onChange={(value) => setModes(value as PhraseMode[])}
          aria-label="话术版式"
        />
      )}

      <Button type="primary" loading={loading} disabled={!canRun} onClick={() => void run()}>
        生成
      </Button>

      {loading && <LoadingBlock />}

      {!loading && singleResult && (
        <ResultBlock
          label="结果"
          onApply={onApply ? () => apply(singleResult) : undefined}
          onCopy={() => void copy(singleResult)}
        >
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
            {singleResult}
          </Typography.Paragraph>
        </ResultBlock>
      )}

      {!loading && phrasesResult && (
        <Space orientation="vertical" style={{ width: "100%" }} size="small">
          {(
            [
              ["star", "STAR 版"],
              ["resume", "简历版"],
              ["interview", "面试口述版"],
            ] as const
          )
            .filter(([key]) => phrasesResult[key])
            .map(([key, label]) => (
              <ResultBlock
                key={key}
                label={label}
                onApply={onApply ? () => apply(phrasesResult[key]) : undefined}
                onCopy={() => void copy(phrasesResult[key])}
              >
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                  {phrasesResult[key]}
                </Typography.Paragraph>
              </ResultBlock>
            ))}
        </Space>
      )}
    </Space>
  );
}

function ResultBlock({
  label,
  onApply,
  onCopy,
  children,
}: {
  label: string;
  /** 有可写目标时优先回填；没有才退回复制。 */
  onApply?: () => void;
  onCopy: () => void;
  children: React.ReactNode;
}) {
  useLocale();
  const run = onApply ?? onCopy;
  return (
    <div style={{ border: "1px solid var(--rf-border)", borderRadius: 8, padding: 12 }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Text strong>{label}</Typography.Text>
        <Button
          size="small"
          type="link"
          icon={onApply ? <CheckOutlined /> : <CopyOutlined />}
          onClick={run}
        >
          {onApply ? t("writing.action.apply") : t("writing.action.copy")}
        </Button>
      </Space>
      {children}
    </div>
  );
}
