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
import AbortButton from "./common/AbortButton";
import { useMemo, useState } from "react";
import {
  generatePhrases,
  polishResumeText,
  rewriteStar,
  translateResumeText,
} from "../api/resumeWriting";
import { errorText, useAbortableRequest } from "../hooks/useAbortableRequest";
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

const OPERATIONS: { value: Operation; labelKey: MessageKey }[] = [
  { value: "star", labelKey: "writing.operation.star" },
  { value: "phrases", labelKey: "writing.operation.phrases" },
  { value: "polish", labelKey: "writing.operation.polish" },
  { value: "translate", labelKey: "writing.operation.translate" },
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

const POLISH_STYLES: { value: PolishStyle; labelKey: MessageKey }[] = [
  { value: "big_tech", labelKey: "writing.style.bigTech" },
  { value: "concise_tech", labelKey: "writing.style.conciseTech" },
  { value: "campus", labelKey: "writing.style.campus" },
];

const PHRASE_MODES: { value: PhraseMode; labelKey: MessageKey }[] = [
  { value: "star", labelKey: "writing.phraseMode.star" },
  { value: "resume", labelKey: "writing.phraseMode.resume" },
  { value: "interview", labelKey: "writing.phraseMode.interview" },
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
  // 四个动作都是一次现场生成：等着的时候可以停，停完还能立刻换一个动作再点。
  const writingRequest = useAbortableRequest();
  const loading = writingRequest.loading;
  const [singleResult, setSingleResult] = useState("");
  const [phrasesResult, setPhrasesResult] = useState<PhrasesResult | null>(null);

  const canRun = useMemo(() => text.trim().length > 0, [text]);

  const run = async () => {
    if (!canRun || loading) return;
    const trimmed = text.trim();
    // **不先清空**上一次的结果：用户点了停止就该看到自己原来那份还在。
    const outcome = await writingRequest.run(async (signal) => {
      if (operation === "star") {
        return {
          kind: "single" as const,
          text: (await rewriteStar(resumeId, trimmed, undefined, signal)).result,
        };
      }
      if (operation === "phrases") {
        return {
          kind: "phrases" as const,
          data: await generatePhrases(resumeId, trimmed, modes, signal),
        };
      }
      if (operation === "polish") {
        return {
          kind: "single" as const,
          text: (await polishResumeText(resumeId, trimmed, polishStyle, signal)).result,
        };
      }
      return {
        kind: "single" as const,
        text: (await translateResumeText(resumeId, trimmed, direction, signal)).result,
      };
    });
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("writing.generate.failed")));
      return;
    }
    // 停止：不回填半截内容，也不动上一次的结果，更不弹错误。
    if (outcome.status === "aborted") return;
    if (outcome.data.kind === "phrases") {
      setPhrasesResult(outcome.data.data);
      setSingleResult("");
    } else {
      setSingleResult(outcome.data.text);
      setPhrasesResult(null);
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
        placeholder={t("writing.input.placeholder")}
        onChange={(event) => setText(event.target.value)}
        aria-label={t("writing.input.ariaLabel")}
      />

      <Segmented
        block
        options={OPERATIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
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
          aria-label={t("writing.style.ariaLabel")}
        >
          {POLISH_STYLES.map((item) => (
            <Radio.Button key={item.value} value={item.value}>
              {t(item.labelKey)}
            </Radio.Button>
          ))}
        </Radio.Group>
      )}

      {operation === "translate" && (
        <Radio.Group
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          aria-label={t("writing.direction.ariaLabel")}
        >
          <Radio.Button value="zh2en">{t("writing.direction.zh2en")}</Radio.Button>
          <Radio.Button value="en2zh">{t("writing.direction.en2zh")}</Radio.Button>
        </Radio.Group>
      )}

      {operation === "phrases" && (
        <Checkbox.Group
          options={PHRASE_MODES.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
          value={modes}
          onChange={(value) => setModes(value as PhraseMode[])}
          aria-label={t("writing.phraseMode.ariaLabel")}
        />
      )}

      <Space wrap>
        <Button type="primary" loading={loading} disabled={!canRun} onClick={() => void run()}>
          {t("writing.action.generate")}
        </Button>
        {loading && <AbortButton onClick={() => writingRequest.cancel()} />}
      </Space>

      {loading && <LoadingBlock />}

      {!loading && singleResult && (
        <ResultBlock
          label={t("writing.result.label")}
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
              ["star", "writing.phraseMode.star"],
              ["resume", "writing.phraseMode.resume"],
              ["interview", "writing.phraseMode.interview"],
            ] as const
          )
            .filter(([key]) => phrasesResult[key])
            .map(([key, labelKey]) => (
              <ResultBlock
                key={key}
                label={t(labelKey)}
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
