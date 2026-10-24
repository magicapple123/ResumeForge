// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台中栏 → 右栏的**草稿通道**（P0-7）。
 *
 * 这一条链路是整批里唯一有**数据丢失**风险的改动，所以每条都是机械断言：
 *
 * - 输入过程中服务端那份 `content` 对象一个字都不能被改（回灌的典型成因就是把它写回）；
 * - 草稿必须带上用户输入、且照片原样保留（合并口径与保存同一句 `mergePartial`）；
 * - `onDraftReset` 的**三个**调用点各一条：内容签名变化的重填 / 放弃修改 / 保存成功。
 *   漏任何一个，用户看到的就是"存完了预览还是旧内容"或"放弃了纸上还在"（设计 §7 R2）。
 *
 * 放在独立文件里而不是塞进主用例：单文件 500 行预算是零豁免的，测试文件同样算。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent } from "../../types";
import { createResumeDraftStore } from "../../features/resume/resumeDraftContent";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";

const CONTENT: ResumeContent = {
  photo: "data:image/png;base64,AAAA",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "后端开发",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

function renderColumn(props: Partial<ComponentProps<typeof ResumeWorkbenchEditorColumn>> = {}) {
  const onSave = (props.onSave ?? vi.fn(async () => undefined)) as unknown as Mock;
  const utils = render(
    <AntdApp>
      <ResumeWorkbenchEditorColumn
        active
        content={CONTENT}
        resumeId={42}
        onSave={onSave}
        {...props}
      />
    </AntdApp>,
  );
  return { ...utils, onSave };
}

/** 姓名输入框：antd 给 `Form.Item name="name"` 生成的 id 就是字段名。 */
function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function typeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(t("workbench.action.save-content")) });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

/**
 * 草稿通道（P0-7）：中栏 → 右栏的**单向**上报。
 *
 * 这一组是整批里唯一有**数据丢失**风险的改动，所以每条都是机械断言：
 *
 * - 输入过程中服务端那份 `content` 对象一个字都不能被改（回灌的典型成因就是把它写回）；
 * - 草稿必须带上用户输入、且照片原样保留（合并口径与保存同一句）；
 * - `onDraftReset` 的**三个**调用点各一条：内容签名变化的重填 / 放弃修改 / 保存成功。
 *   漏任何一个，用户看到的就是"存完了预览还是旧内容"或"放弃了纸上还在"（设计 §7 R2）。
 */
describe("中栏 · 草稿通道（P0-7）", () => {
  /** 重新渲染同一个中栏，只换 `content`（模拟宿主换了一份 detail）。 */
  function rerenderWith(
    rerender: (ui: React.ReactElement) => void,
    content: ResumeContent,
    draftStore: ReturnType<typeof createResumeDraftStore>,
  ) {
    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={content}
          resumeId={42}
          onSave={vi.fn(async () => undefined)}
          draftStore={draftStore}
        />
      </AntdApp>,
    );
  }

  it("输入 3 次：草稿带上用户输入、照片保留、服务端那份 content 对象没被改写", async () => {
    const draftStore = createResumeDraftStore(0);
    // 记下进入用例时的那一份（后面要断言它**一个字都没变**）。
    const savedContent = CONTENT;
    renderColumn({ draftStore });

    typeName("李");
    typeName("李四");
    typeName("李四光");

    // 1) 表单里仍是用户输入：没有任何"回灌"把服务端那份写回来。
    expect(nameInput().value).toBe("李四光");
    // 2) 草稿一路往上走（右栏订阅的就是它）。
    await waitFor(() => expect(draftStore.getSnapshot()?.name).toBe("李四光"));
    // 3) 合并口径与保存同一句：照片不在表单里，必须原样带上。
    expect(draftStore.getSnapshot()?.photo).toBe(CONTENT.photo);
    // 4) 服务端那一份对象没有被改写过（回灌的最典型形态就是改它）。
    expect(savedContent.name).toBe("张三");
    // 5) 草稿是一份**新**对象，不是 `content` prop 本身（防"草稿变成 content"）。
    expect(draftStore.getSnapshot()).not.toBe(savedContent);
  });

  it("用同一份 content 重渲染不清空用户输入（content 引用不变 = 不回灌）", async () => {
    const draftStore = createResumeDraftStore(0);
    const { rerender } = renderColumn({ draftStore });

    typeName("李四");
    await waitFor(() => expect(draftStore.getSnapshot()?.name).toBe("李四"));

    // 宿主因别的原因重渲染（版式变化、父组件 state 变化……），正文引用**没变**。
    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={CONTENT}
          resumeId={42}
          onSave={vi.fn(async () => undefined)}
          draftStore={draftStore}
        />
      </AntdApp>,
    );

    expect(nameInput().value).toBe("李四");
    expect(draftStore.getSnapshot()?.name).toBe("李四");
  });

  it("内容签名变了（宿主换了另一份正文）→ 草稿通道复位、表单重填", async () => {
    const draftStore = createResumeDraftStore(0);
    const { rerender } = renderColumn({ draftStore });

    typeName("李四");
    await waitFor(() => expect(draftStore.getSnapshot()?.name).toBe("李四"));

    rerenderWith(rerender, { ...CONTENT, name: "王五" }, draftStore);

    // R2 第 1 处：不复位的话右栏会继续显示"李四"那一版，与刚重填的表单不是一回事。
    await waitFor(() => expect(draftStore.getSnapshot()).toBeNull());
    expect(nameInput().value).toBe("王五");
  });

  it("放弃修改（确认后）→ 草稿通道复位（R2 第 2 处）", async () => {
    const draftStore = createResumeDraftStore(0);
    renderColumn({ draftStore });

    typeName("李四");
    await waitFor(() => expect(draftStore.getSnapshot()?.name).toBe("李四"));

    fireEvent.click(screen.getByRole("button", { name: t("workbench.action.discard-edits") }));
    fireEvent.click(await screen.findByRole("button", { name: t("common.action.discard") }));

    await waitFor(() => expect(draftStore.getSnapshot()).toBeNull());
    expect(nameInput().value).toBe(CONTENT.name);
  });

  it("保存成功后 → 草稿通道复位（R2 第 3 处）", async () => {
    const draftStore = createResumeDraftStore(0);
    const onSave = vi.fn(async () => undefined);
    renderColumn({ draftStore, onSave });

    typeName("李四");
    await waitFor(() => expect(draftStore.getSnapshot()?.name).toBe("李四"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(draftStore.getSnapshot()).toBeNull());
  });

  it("保存失败 → 草稿**不复位**（右栏不能因为一次失败就跳回旧内容）", async () => {
    const draftStore = createResumeDraftStore(0);
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    renderColumn({ draftStore, onSave: failing });

    typeName("赵六");
    await waitFor(() => expect(draftStore.getSnapshot()?.name).toBe("赵六"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));

    expect(draftStore.getSnapshot()?.name).toBe("赵六");
    expect(nameInput().value).toBe("赵六");
  });

  it("没有草稿通道时（不传 draftStore）中栏一切照旧", async () => {
    const { onSave } = renderColumn();

    typeName("李四");
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as ResumeContent).name).toBe("李四");
  });
});
