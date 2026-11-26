// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒关联外部简历（R14）的展示与提交：卡片 / 详情 / 表单。
 *
 * 三条线：
 * 1. **展示**：关联了外部简历的提醒在列表卡副行与详情抽屉里都显示「外部 · 文件名」——
 *    内部简历没有后端回显的名字，只在这里看外部那一侧；
 * 2. **提交**：表单值是复合串（`external:7`），保存时拆成两个纯 id 字段，两个键都要给
 *    （只给外部 id 会让库里留着的内部 id 变成"两个都关联"，后端 422）；
 * 3. **计数**：「关联 N 项」问的是"关联了几个对象"，外部简历也算 1 项。
 *
 * 为什么单独一个文件：`ReminderPanel.test.tsx` 已经用到 342 行，而这一批用例需要自己
 * 的一组 API mock（内部 / 外部简历列表 + 单条回查），`vi.mock` 是模块级的，必须跟着走。
 *
 * cjkRatchet 守卫：界面文案一律 `t()` 取，假数据用 ASCII 名字。
 */
import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ReminderPanel from "./ReminderPanel";

const apiMocks = vi.hoisted(() => ({
  listReminders: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  snoozeReminder: vi.fn(),
  deleteReminder: vi.fn(),
}));
vi.mock("../../api/reminders", () => apiMocks);

const settingsMocks = vi.hoisted(() => ({ getAgentTaskEvents: vi.fn() }));
vi.mock("../../api/settings", () => settingsMocks);

/** 进度 / 岗位下拉在这一批用例里不需要真实数据，给空壳即可。 */
const selectMocks = vi.hoisted(() => ({
  track: { selectProps: {}, options: [], reload: vi.fn(), ensure: vi.fn() },
  job: { selectProps: {}, options: [], reload: vi.fn(), ensure: vi.fn() },
}));
vi.mock("../../hooks/remoteSearchOptions", () => ({
  useTrackSearchSelect: () => selectMocks.track,
  useJobSearchSelect: () => selectMocks.job,
}));

/** 「关联简历」选择器是**真的**（被测对象之一），只把它的两个数据源换成 mock。 */
const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
const externalMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  getExternalResume: vi.fn(),
}));
vi.mock("../../api/resumes", () => resumesMocks);
vi.mock("../../api/externalResumes", () => externalMocks);

const ITEM_TITLE = "Follow up on the upload";
const EXTERNAL_NAME = "Old external.pdf";
const EXTERNAL_ID = 7;

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: ITEM_TITLE,
    remind_at: "2026-12-01T10:00:00",
    kind: "hr_reply",
    status: "active",
    track_id: null,
    job_id: null,
    resume_id: null,
    external_resume_id: null,
    external_resume_name: "",
    note: "",
    created_at: "2026-11-20T08:00:00",
    updated_at: "2026-11-20T08:00:00",
    ...overrides,
  };
}

/** 关联了外部简历的那一条（列表 / 详情 / 编辑共用）。 */
const LINKED = makeItem({
  external_resume_id: EXTERNAL_ID,
  external_resume_name: EXTERNAL_NAME,
});

/** 「外部 · 文件名」的期望文案（标签走 i18n，不写死中文）。 */
const EXTERNAL_LABEL = `${t("reminder.resume.externalTag")} · ${EXTERNAL_NAME}`;

function renderPanel() {
  return render(
    <MemoryRouter>
      <AntApp>
        <ReminderPanel />
      </AntApp>
    </MemoryRouter>,
  );
}

/** 文案可能被拆进同一节点的长串里，用"包含"匹配并允许命中多个祖先节点。 */
async function findByContaining(text: string) {
  const matches = await screen.findAllByText((content) => content.includes(text));
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

/** 打开「更多操作 → 编辑」。 */
async function openEdit() {
  fireEvent.click(screen.getByRole("button", { name: t("common.action.more") }));
  fireEvent.click(await screen.findByText(t("reminderItem.action.edit")));
}

beforeEach(() => {
  apiMocks.listReminders.mockReset().mockResolvedValue([LINKED]);
  apiMocks.createReminder.mockReset().mockResolvedValue(LINKED);
  apiMocks.updateReminder.mockReset().mockResolvedValue(LINKED);
  apiMocks.snoozeReminder.mockReset().mockResolvedValue(LINKED);
  apiMocks.deleteReminder.mockReset().mockResolvedValue(undefined);
  settingsMocks.getAgentTaskEvents.mockReset().mockResolvedValue({ enabled: true });
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  resumesMocks.getResume.mockReset().mockRejectedValue(new Error("404"));
  externalMocks.listExternalResumes.mockReset().mockResolvedValue({
    items: [{ id: EXTERNAL_ID, name: EXTERNAL_NAME, mime: "application/pdf" }],
    total: 1,
    page: 1,
    page_size: 50,
  });
  externalMocks.getExternalResume
    .mockReset()
    .mockResolvedValue({ id: EXTERNAL_ID, name: EXTERNAL_NAME, mime: "application/pdf" });
});

// RTL 会在每个用例后自动 cleanup：这里不再手动清 `document.body`，
// antd 的 Modal / message 门户由它自己的销毁流程收尾（手动清会撞上"门户节点已被移除"）。

describe("展示：外部简历带「外部 · 」前缀", () => {
  it("提醒卡副行显示「外部 · 文件名」", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    await findByContaining(EXTERNAL_LABEL);
  });

  it("详情抽屉的「关联简历」也是同一个标签", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    fireEvent.click(screen.getByRole("button", { name: t("reminderItem.action.detail") }));

    expect(await screen.findByText(t("reminder.detail.resume"))).toBeInTheDocument();
    await findByContaining(EXTERNAL_LABEL);
  });

  it("没关联外部简历的提醒不显示这个标签", async () => {
    apiMocks.listReminders.mockResolvedValue([makeItem()]);
    renderPanel();
    await screen.findByText(ITEM_TITLE);

    expect(screen.queryByText((content) => content.includes(EXTERNAL_LABEL))).toBeNull();
  });
});

describe("提交：复合值拆成两个纯 id", () => {
  /** 请求体里这两个键只能是 `number` 或 `null`——传对象/复合串服务端会 422（int 字段）。 */
  function expectPureIds(payload: Record<string, unknown>) {
    for (const key of ["resume_id", "external_resume_id"]) {
      const value = payload[key];
      expect(value === null || typeof value === "number").toBe(true);
    }
  }

  it("编辑后直接保存，请求体带 resume_id=null + external_resume_id，且不含复合串", async () => {
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    await openEdit();

    fireEvent.click(await screen.findByRole("button", { name: t("reminder.modal.save") }));

    await waitFor(() => expect(apiMocks.updateReminder).toHaveBeenCalled());
    const [id, payload] = apiMocks.updateReminder.mock.calls[0];
    expect(id).toBe(1);
    expect(payload).toEqual(
      expect.objectContaining({ resume_id: null, external_resume_id: EXTERNAL_ID }),
    );
    // 复合串只活在表单里：请求体里不该出现 `external:7`。
    expect(JSON.stringify(payload)).not.toContain("external:");
    expect(JSON.stringify(payload)).not.toContain("resume_ref");
    expectPureIds(payload as Record<string, unknown>);
  });

  it("内部简历关联同理：resume_id 是数字、external_resume_id 是 null（不是整条记录）", async () => {
    const internalId = 23;
    apiMocks.listReminders.mockResolvedValue([makeItem({ resume_id: internalId })]);
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    await openEdit();

    fireEvent.click(await screen.findByRole("button", { name: t("reminder.modal.save") }));

    await waitFor(() => expect(apiMocks.updateReminder).toHaveBeenCalled());
    const [, payload] = apiMocks.updateReminder.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({ resume_id: internalId, external_resume_id: null }),
    );
    expectPureIds(payload as Record<string, unknown>);
  });
});

describe("折叠区计数", () => {
  it("「已关联 N 项」把外部简历算进去", async () => {
    apiMocks.listReminders.mockResolvedValue([
      makeItem({ ...LINKED, track_id: 3, external_resume_id: EXTERNAL_ID }),
    ]);
    renderPanel();
    await screen.findByText(ITEM_TITLE);
    await openEdit();

    expect(
      await screen.findByText(t("reminder.field.linkedCount", { count: 2 })),
    ).toBeInTheDocument();
  });
});
