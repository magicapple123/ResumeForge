// SPDX-License-Identifier: Apache-2.0
/**
 * 结果区下方的「再改一版」快捷微调：四个 chip + 一个自定义要求输入。
 *
 * 都走 `POST /api/writing/polish-selection`（入参 `{ text, instruction }`，**不回写任何
 * 数据**），`text` 用**当前这一版结果**、不用原文：用户要的是"在这版上接着改"，
 * 从原文重来会把上一版的改进白丢。
 */
import { Button, Input, Space, Typography } from "antd";
import { useState } from "react";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/**
 * 自定义要求的上限。服务端 `instruction` 允许 500 字，这里收在 200：一句话的要求
 * 写不到 200 字，再长就是"把要求写成小作文"，模型反而会丢掉重点。
 */
export const MAX_REFINE_INSTRUCTION_CHARS = 200;

interface RefineChip {
  id: string;
  labelKey: MessageKey;
  /** 发给模型的指令（中文），不是界面文案。 */
  prompt: string;
}

const CHIPS: readonly RefineChip[] = [
  {
    id: "shorter",
    labelKey: "writing.refine.shorter",
    // i18n-ok: 喂给模型的 prompt，不上界面
    prompt: "在保留全部事实的前提下，把这段文字压缩得更短、更紧凑。",
  },
  {
    id: "specific",
    labelKey: "writing.refine.specific",
    // i18n-ok: 喂给模型的 prompt，不上界面
    prompt: "把其中笼统的表述改得更具体：说清做了什么、怎么做的、面向谁。",
  },
  {
    id: "colloquial",
    labelKey: "writing.refine.colloquial",
    // i18n-ok: 喂给模型的 prompt，不上界面
    prompt: "改写成适合面试口述的口语表达：句子短一些，少用书面腔。",
  },
  {
    id: "quantify",
    labelKey: "writing.refine.quantify",
    // i18n-ok: 喂给模型的 prompt，不上界面
    prompt: "在不编造数据的前提下，尽量补上可以量化的规模、比例或结果。",
  },
];

interface Props {
  /** 迭代请求在飞：所有入口一起禁用，避免两条请求互相覆盖。 */
  loading: boolean;
  /** 交出一条指令；返回 `true` 表示成功（自定义输入据此决定是否清空）。 */
  onRefine: (instruction: string) => Promise<boolean>;
}

export default function WritingRefineChips({ loading, onRefine }: Props) {
  // 模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const [custom, setCustom] = useState("");
  const trimmed = custom.trim();

  const submit = async () => {
    if (!trimmed || loading) return;
    const ok = await onRefine(trimmed);
    // 成功才清空：失败时用户刚写的要求还留着，改一改就能重试。
    if (ok) setCustom("");
  };

  return (
    <div className="resume-writing-refine">
      <Space size={4} wrap>
        <Typography.Text type="secondary" className="resume-writing-refine-label">
          {t("writing.refine.label")}
        </Typography.Text>
        {CHIPS.map((chip) => (
          <Button
            key={chip.id}
            size="small"
            disabled={loading}
            onClick={() => void onRefine(chip.prompt)}
          >
            {t(chip.labelKey)}
          </Button>
        ))}
      </Space>
      <Space.Compact style={{ width: "100%" }}>
        <Input
          value={custom}
          // 超长直接截断（antd 的 maxLength 在输入与粘贴时都生效），而不是等到提交才报错。
          maxLength={MAX_REFINE_INSTRUCTION_CHARS}
          placeholder={t("writing.refine.customPlaceholder")}
          aria-label={t("writing.refine.customAriaLabel")}
          disabled={loading}
          onChange={(event) => setCustom(event.target.value)}
          onPressEnter={() => void submit()}
        />
        <Button
          type="primary"
          ghost
          loading={loading}
          disabled={!trimmed}
          onClick={() => void submit()}
        >
          {t("writing.refine.submit")}
        </Button>
      </Space.Compact>
    </div>
  );
}
