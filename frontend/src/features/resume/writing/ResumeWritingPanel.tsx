// SPDX-License-Identifier: Apache-2.0
/** 简历写作增强面板：STAR 改写 / 话术生成 / 风格润色 / 中英互译。
 *
 * 自包含：一段文本进、一段文本出。
 *
 * **结果默认回填**（2026-10-24 最终口径）：面板现在是从**右键菜单**打开的弹窗，入参就是
 * 用户刚选中的那一段，`onApply` 由宿主直接写回那个选区——所见即所得，不用再复制粘贴。
 * 没有可写目标时（右键落在普通段落上）宿主不传 `onApply`，面板退回「复制」，
 * 因为那种情况下"回填到哪里"根本没有答案，按钮点下去只会静默失败。
 *
 * ## 结果是可以接着改的（2026-11「功能更强大」）
 *
 * 生成完不是终点：结果区下方有一排快捷微调（更短 / 更具体 / 更口语 / 加量化）与一个
 * 自定义要求输入，都走 `polish-selection`——**输入是当前这一版结果**，原文始终留在上方
 * 输入框里不动。每次生成/迭代推入版本栈（最多 5 版），可点 v1/v2/v3 切回去再回填。
 *
 * 拆出去的三块：版本栈 `writing/useWritingVersions.ts`、结果区
 * `writing/WritingResultPane.tsx`、微调入口 `writing/WritingRefineChips.tsx`。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Radio, Segmented, Space, Typography } from "antd";
import LoadingBlock from "../../../components/common/LoadingBlock";
import AbortButton from "../../../components/common/AbortButton";
import { useMemo, useState } from "react";
import {
  generatePhrases,
  polishResumeText,
  rewriteStar,
  translateResumeText,
} from "../../../api/resumeWriting";
import { polishSelection } from "../../../api/writing";
import { errorText, useAbortableRequest } from "../../../hooks/useAbortableRequest";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type {
  PhraseMode,
  PhrasesResult,
  PolishStyle,
  TranslateDirection,
} from "../../../types/resumeWriting";
import { copyText } from "../../../utils/clipboard";
import WritingResultPane, { WritingResultBlock } from "../../writing/WritingResultPane";
import { useWritingVersions } from "../../writing/useWritingVersions";

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
  /** 用法说明默认收成一行：它曾经占掉首屏，把结果区挤出可视范围。 */
  const [hintOpen, setHintOpen] = useState(false);
  // 四个动作都是一次现场生成：等着的时候可以停，停完还能立刻换一个动作再点。
  const writingRequest = useAbortableRequest();
  // 迭代（polish-selection）单独一条通道：生成与迭代是两种请求，各自的在飞状态互不覆盖。
  const refineRequest = useAbortableRequest();
  const loading = writingRequest.loading;
  const versions = useWritingVersions();
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
      // 话术是"三份不同用途的稿子"，没有版本概念：清掉单条结果的栈，避免旧版本被回填。
      versions.clear();
      setPhrasesResult(outcome.data.data);
      return;
    }
    setPhrasesResult(null);
    versions.push(outcome.data.text);
  };

  /**
   * 在一版结果上继续改（chip / 自定义要求共用）。
   *
   * `text` 用**当前这一版**而不是原文；成功后新一版进栈并选中，失败则结果与版本栈原样
   * 保留（弹一条错误，绝不产生空版本）。
   */
  const refine = async (instruction: string): Promise<boolean> => {
    const source = versions.current?.text ?? "";
    const trimmed = instruction.trim();
    if (!source || !trimmed || refineRequest.loading) return false;
    const outcome = await refineRequest.run((signal) => polishSelection(source, trimmed, signal));
    if (outcome.status === "aborted") return false;
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("writing.refine.failed")));
      return false;
    }
    const next = outcome.data.result.trim();
    // 空结果等于把用户已有的版本换没了：当成失败处理，旧版本继续留着。
    if (!next) {
      message.error(t("writing.refine.failed"));
      return false;
    }
    versions.push(next);
    return true;
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
          选什么、结果去哪。默认收成一行（2026-11：整块常驻把结果区挤出首屏），
          展开后才是完整说明；标题行本身就是"这卡能干什么"的一句话。 */}
      <div className="resume-writing-hint">
        <button
          type="button"
          className="resume-writing-hint-toggle"
          aria-expanded={hintOpen}
          onClick={() => setHintOpen((open) => !open)}
        >
          <InfoCircleOutlined aria-hidden />
          <span className="resume-writing-hint-toggle-text">{t("writing.hint.title")}</span>
          <span className="resume-writing-hint-toggle-action">
            {hintOpen ? t("writing.hint.collapse") : t("writing.hint.expand")}
          </span>
        </button>
        {hintOpen && <p className="resume-writing-hint-body">{t("writing.hint.body")}</p>}
      </div>

      <Input.TextArea
        rows={3}
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

      {/* 动作说明与「生成」同一行，按钮靠右：说明是"这个动作会怎么改我的句子"，
          紧贴着触发它的那颗按钮才读得顺，也省下一行高度给结果区。 */}
      <div className="resume-writing-actions-row">
        <Typography.Text type="secondary" className="resume-writing-hint-line">
          {t(OPERATION_HINTS[operation])}
        </Typography.Text>
        <Space size={8}>
          <Button type="primary" loading={loading} disabled={!canRun} onClick={() => void run()}>
            {t("writing.action.generate")}
          </Button>
          {loading && <AbortButton onClick={() => writingRequest.cancel()} />}
        </Space>
      </div>

      {loading && <LoadingBlock />}

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
              <WritingResultBlock
                key={key}
                label={t(labelKey)}
                onApply={onApply ? () => apply(phrasesResult[key]) : undefined}
                onCopy={() => void copy(phrasesResult[key])}
              >
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                  {phrasesResult[key]}
                </Typography.Paragraph>
              </WritingResultBlock>
            ))}
        </Space>
      )}

      {!loading && !phrasesResult && (
        <WritingResultPane
          versions={versions}
          onApply={onApply ? apply : undefined}
          onCopy={(result) => void copy(result)}
          onRefine={refine}
          refining={refineRequest.loading}
        />
      )}
    </Space>
  );
}
