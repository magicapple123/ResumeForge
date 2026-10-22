// SPDX-License-Identifier: Apache-2.0
/**
 * 简历编辑弹窗的草稿接线（与 `settings/LLMRecordModal.test.tsx` 的「草稿恢复」同形）：
 *
 * 1. 命中草稿**不自动填充**——恢复条先问一次，点了才写进表单。自动填充会让用户以为
 *    "这份简历本来就有这些改动"；
 * 2. 作用域必须能区分"这次是给哪个岗位写的"——缺省按 `resumeId` 分；没有 `resumeId` 的
 *    入口（岗位详情的「自行编写」）靠 `draftScopeKey` 把岗位维度拼进去，否则在岗位 A
 *    放弃的草稿会出现在岗位 B 里、还能一键灌进去。
 *
 * 名字断言用文案 key 或数据夹具，不写中文字面量：`cjkRatchet` 对 `*ByText` 的中文参数
 * 是逐个文件计数、只降不升的。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { clearDraft, writeDraft } from "../utils/formDraftStorage";
import { CONTENT } from "./ResumeEditorModal.testkit";
import ResumeEditorModal from "./ResumeEditorModal";

/** 缺省作用域：不传 `resumeId` / `draftScopeKey` 时用的那一个。 */
const DEFAULT_SCOPE = "resume.edit#new";
/** 岗位模式的两个作用域（`ManualResumeModal` 拼出来的形态）。 */
const SCOPE_JOB_A = "resume.edit#new@job-1";
const SCOPE_JOB_B = "resume.edit#new@job-2";

function renderEditor(draftScopeKey?: string) {
  return render(
    <AntdApp>
      <ResumeEditorModal
        open
        content={CONTENT}
        draftScopeKey={draftScopeKey}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    </AntdApp>,
  );
}

/** 表单当前的姓名（每次重新查节点：恢复之后 React 可能换掉 DOM）。 */
function nameValue(): string {
  const input = screen.getByLabelText("姓名") as HTMLInputElement;
  return input.value;
}

/** 三个作用域都要清：草稿落在 sessionStorage 里，会跨用例留下（同文件共享一个 window）。 */
function clearAllDrafts(): void {
  clearDraft(DEFAULT_SCOPE);
  clearDraft(SCOPE_JOB_A);
  clearDraft(SCOPE_JOB_B);
}

beforeEach(() => {
  clearAllDrafts();
});

afterEach(() => {
  cleanup();
  clearAllDrafts();
});

describe("ResumeEditorModal 草稿恢复", () => {
  it("命中草稿不自动填充，点「恢复这份草稿」才写进表单", async () => {
    writeDraft(DEFAULT_SCOPE, { name: "李四", job_intent: "草稿里的意向" });

    renderEditor();

    // 恢复条出现 = 读到了草稿；此刻表单仍是载入时的内容，没有被草稿顶掉。
    const restore = await screen.findByRole("button", { name: t("draft.restore.action") });
    expect(nameValue()).toBe(CONTENT.name);
    expect(screen.getByLabelText("求职意向")).toHaveValue(CONTENT.job_intent);

    fireEvent.click(restore);

    await waitFor(() => expect(nameValue()).toBe("李四"));
    expect(screen.getByLabelText("求职意向")).toHaveValue("草稿里的意向");
    // 取用之后恢复条消失：不会重复问第二遍。
    expect(screen.queryByRole("button", { name: t("draft.restore.action") })).toBeNull();
  });
});

describe("ResumeEditorModal 草稿作用域（跨岗位不串内容）", () => {
  it("岗位 A 的草稿不会出现在岗位 B；换回 A 的作用域才有恢复条", async () => {
    writeDraft(SCOPE_JOB_A, { name: "岗位A的草稿" });

    const jobB = renderEditor(SCOPE_JOB_B);
    await jobB.findByLabelText("姓名");
    // 等一拍：读草稿发生在 effect 里，若两个槽串了，恢复条这时已经出现了。
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: t("draft.restore.action") })).toBeNull(),
    );
    expect(nameValue()).toBe(CONTENT.name);
    jobB.unmount();

    // 反向对照：换成 A 的作用域，一打开就有恢复条（证明上面不是"恢复条永不出现"）。
    renderEditor(SCOPE_JOB_A);
    expect(
      await screen.findByRole("button", { name: t("draft.restore.action") }),
    ).toBeInTheDocument();
  });
});
