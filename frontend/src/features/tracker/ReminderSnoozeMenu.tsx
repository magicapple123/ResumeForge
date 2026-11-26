// SPDX-License-Identifier: Apache-2.0
/**
 * 「稍后」动作的共用入口（CR-28）：1 小时 / 今晚 20:00 / 明早 9:00 / 自定义时刻。
 *
 * 三处提醒界面（求职进度列表行、首页启动弹窗、助手任务卡）共用这份菜单，避免同一个
 * 动作在三处各写一套预设、彼此漂移。预设只发名字（`one_hour` / `tonight` /
 * `tomorrow_morning`），绝对时刻按**用户本机时区**在后端解析——前端不自己算 20:00。
 *
 * `onSnooze` 由宿主提供（它才知道是列表行还是弹窗、成功后要不要刷新），本组件只负责
 * 收起菜单、收自定义时刻、把 promise 的失败交给宿主提示。
 */
import { ClockCircleOutlined, EllipsisOutlined } from "@ant-design/icons";
import { Button, DatePicker, Dropdown, Modal, Space } from "antd";
import type { MenuProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ReminderSnoozePayload, ReminderSnoozePreset } from "../../types";

/**
 * 追加到同一份菜单尾部的动作项（T25 / R24）。
 *
 * 首页启动弹窗的行内只留「完成」+ `⋯`：稍后与忽略必须在**同一个**菜单里，否则 460px
 * 的卡片上又会长出第二个下拉。这条口子让调用方把「忽略」递进来，而不是在 `⋯` 里
 * 再抄一遍预设——预设只有本组件一份。
 */
export interface ReminderSnoozeExtraItem {
  /** 菜单项 key；不许与 `one_hour` / `tonight` / `tomorrow_morning` / `custom` 重名。 */
  key: string;
  label: string;
  onSelect: () => void;
}

interface Props {
  /** 执行推迟；返回 promise 以便自定义弹层在成功后关闭。失败由宿主提示。 */
  onSnooze: (payload: ReminderSnoozePayload) => Promise<unknown> | void;
  /** 请求中禁用（同一行连点会发两次）。 */
  disabled?: boolean;
  /** 行内用 small，弹窗/卡片里可用默认尺寸。 */
  size?: "small" | "middle";
  /** 触发按钮只显示「⋯」图标（弹窗行内只留「完成」+ ⋯ 时用）。 */
  iconTrigger?: boolean;
  /** `iconTrigger` 时触发按钮的无障碍名；缺省退回「稍后」。 */
  triggerAriaLabel?: string;
  /** 追加到同一份菜单尾部的动作项（如「忽略」）；空数组等于不追加。 */
  extraItems?: ReminderSnoozeExtraItem[];
}

/** 自定义时刻的默认值：1 小时后（与预设"1 小时后"同一落点，用户只需微调）。 */
function defaultCustomAt(): Dayjs {
  return dayjs().add(1, "hour").second(0);
}

export default function ReminderSnoozeMenu({
  onSnooze,
  disabled,
  size = "small",
  iconTrigger = false,
  triggerAriaLabel,
  extraItems = [],
}: Props) {
  useLocale();
  const [customOpen, setCustomOpen] = useState(false);
  const [customAt, setCustomAt] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const run = async (payload: ReminderSnoozePayload) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSnooze(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const presets: { key: ReminderSnoozePreset; label: string }[] = [
    { key: "one_hour", label: t("reminder.snooze.oneHour") },
    { key: "tonight", label: t("reminder.snooze.tonight") },
    { key: "tomorrow_morning", label: t("reminder.snooze.tomorrowMorning") },
  ];

  const items: MenuProps["items"] = [
    ...presets.map((preset) => ({ key: preset.key, label: preset.label })),
    { type: "divider" as const },
    { key: "custom", label: t("reminder.snooze.custom") },
    // 追加动作与预设之间也有一条分隔线：一面是"推迟到什么时候"，一面是"不推迟了"。
    ...(extraItems.length > 0
      ? [
          { type: "divider" as const },
          ...extraItems.map((item) => ({ key: item.key, label: item.label })),
        ]
      : []),
  ];

  const onClick: MenuProps["onClick"] = ({ key }) => {
    // 追加动作先行：它们不属于预设，直接交给宿主执行。
    const extra = extraItems.find((item) => item.key === key);
    if (extra) {
      extra.onSelect();
      return;
    }
    if (key === "custom") {
      setCustomAt(defaultCustomAt());
      setCustomOpen(true);
      return;
    }
    void run({ preset: key as ReminderSnoozePreset });
  };

  const confirmCustom = async () => {
    if (!customAt) return;
    setSubmitting(true);
    try {
      // `toISOString()` 给的是带 Z 的绝对时刻，后端与其它写入口径一致。
      await onSnooze({ until: customAt.toDate().toISOString() });
      setCustomOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dropdown menu={{ items, onClick }} trigger={["click"]} disabled={disabled}>
        <Button
          type="text"
          size={size}
          icon={iconTrigger ? <EllipsisOutlined /> : <ClockCircleOutlined />}
          disabled={disabled || undefined}
          aria-label={triggerAriaLabel ?? t("reminder.snooze.action")}
        >
          {iconTrigger ? null : t("reminder.snooze.action")}
        </Button>
      </Dropdown>
      <Modal
        open={customOpen}
        title={t("reminder.snooze.customTitle")}
        onCancel={() => setCustomOpen(false)}
        onOk={() => void confirmCustom()}
        okText={t("common.action.confirm")}
        cancelText={t("common.action.cancel")}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <DatePicker
            showTime={{ format: "HH:mm" }}
            format="YYYY-MM-DD HH:mm"
            value={customAt}
            onChange={(value) => setCustomAt(value)}
            style={{ width: "100%" }}
          />
        </Space>
      </Modal>
    </>
  );
}
