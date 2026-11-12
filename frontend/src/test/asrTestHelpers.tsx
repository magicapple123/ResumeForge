// SPDX-License-Identifier: Apache-2.0
/**
 * 语音配置组件的测试脚手架：造数据 + 常用交互。
 *
 * 三个测试文件共用这一份：造一条配置、打开新建弹窗、填完四段字段。数据形状与后端
 * `AsrProfileOut` 一致（**不含 Key**，只有 `has_key`/`configured` 两个布尔）。
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { t } from "../i18n";
import type { AsrProfile, AsrProfilesState } from "../features/interview-voice/asrApi";

/** 造一条已配置的语音配置；用 overrides 覆盖需要变化的字段。 */
export function makeAsrProfile(overrides: Partial<AsrProfile> = {}): AsrProfile {
  return {
    id: "a_profile_1",
    name: "Work Groq",
    preset_id: "groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3",
    protocol: "openai",
    has_key: true,
    configured: true,
    updated_at: "2026-11-09T10:00:00+00:00",
    ...overrides,
  };
}

export function makeProfilesState(profiles: AsrProfile[], activeProfileId = ""): AsrProfilesState {
  return { active_profile_id: activeProfileId, profiles };
}

/** 去掉全部空白后比较：antd 给两个汉字插空格（「使 用」），图标里也没有文字。 */
function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * 按"按钮可见文字"找按钮，而不是按可访问名。
 *
 * 为什么：@ant-design/icons 渲染成 `role="img"` + 自有 `aria-label`（如 "plus"），
 * 会拼进按钮的可访问名（"plus 新建配置"），按名字精确查会全部查不到；按钮的可见文字
 * 才是我们要断言的东西。两个汉字的按钮会被 antd 排成「使 用」，所以先去空白再比。
 */
export function buttonsByLabel(label: string): HTMLElement[] {
  const target = normalizeLabel(label);
  return screen
    .getAllByRole("button")
    .filter((node) => normalizeLabel(node.textContent ?? "") === target);
}

export function buttonByLabel(label: string): HTMLElement {
  const [first] = buttonsByLabel(label);
  if (!first) throw new Error("button not found: " + label);
  return first;
}
/** 设置卡卡头的「新建配置」按钮（为空时返回 null）。 */
export function createProfileButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: t("voiceInput.settings.profiles.create") });
}

/** 打开新建弹窗并返回弹窗节点。 */
export async function openCreateModal(): Promise<HTMLElement> {
  const button = createProfileButton();
  if (!button) throw new Error("create-profile button not found");
  fireEvent.click(button);
  return screen.findByRole("dialog");
}

/** 在弹窗里按 aria-label 填四段字段。 */
export function fillAsrProfile(values: {
  name?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}) {
  const dialog = screen.getByRole("dialog");
  if (values.name !== undefined) {
    fireEvent.change(within(dialog).getByLabelText(t("voiceInput.settings.modal.name.label")), {
      target: { value: values.name },
    });
  }
  if (values.baseUrl !== undefined) {
    fireEvent.change(within(dialog).getByLabelText(t("voiceInput.settings.baseUrl.aria")), {
      target: { value: values.baseUrl },
    });
  }
  if (values.model !== undefined) {
    fireEvent.change(within(dialog).getByLabelText(t("voiceInput.settings.model.aria")), {
      target: { value: values.model },
    });
  }
  if (values.apiKey !== undefined) {
    fireEvent.change(within(dialog).getByLabelText(t("voiceInput.settings.key.aria")), {
      target: { value: values.apiKey },
    });
  }
}

/** 弹窗 footer 的保存按钮（按可见文字匹配，避开图标 aria-label 与 antd 自动空格）。 */
export function saveButton(): HTMLElement {
  const dialog = screen.getByRole("dialog");
  const label = t("voiceInput.settings.modal.save");
  return within(dialog).getByRole("button", { name: label });
}
