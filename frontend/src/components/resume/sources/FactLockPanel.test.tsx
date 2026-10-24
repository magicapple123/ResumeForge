// SPDX-License-Identifier: Apache-2.0
/** 事实锁面板：列出、新建（带选中定位）、解除、冲突说明。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import type { FactLockOut, FactLockViolationOut } from "../../../features/resume-provenance/types";
import FactLockPanel from "./FactLockPanel";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const LOCK: FactLockOut = {
  id: 1,
  resume_id: 3,
  kind: "institution",
  object_id: "exp_1",
  point_id: null,
  path: "experience.0.company",
  field: "company",
  locked_value: "Cloud Commerce Ltd",
  label: "legal name",
  created_at: null,
};

describe("FactLockPanel", () => {
  it("列出现有锁的类型与锁定值", () => {
    render(
      <AntdApp>
        <FactLockPanel locks={[LOCK]} />
      </AntdApp>,
    );
    expect(screen.getByText(pt("provenance.lock.kind.institution"))).toBeTruthy();
    expect(screen.getByText("Cloud Commerce Ltd")).toBeTruthy();
  });

  it("只读态不渲染新建表单", () => {
    render(
      <AntdApp>
        <FactLockPanel locks={[LOCK]} />
      </AntdApp>,
    );
    expect(screen.queryByRole("button", { name: pt("provenance.lock.add") })).toBeNull();
  });

  it("没有选中对象时新建按钮禁用", () => {
    render(
      <AntdApp>
        <FactLockPanel locks={[]} onCreate={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: pt("provenance.lock.add") })).toBeDisabled();
  });

  it("有选中对象时提交回传 kind + 定位 + 备注", async () => {
    const onCreate = vi.fn();
    render(
      <AntdApp>
        <FactLockPanel
          locks={[]}
          selection={{ object_id: "exp_1", path: "experience.0.company", label: "Experience" }}
          onCreate={onCreate}
        />
      </AntdApp>,
    );
    fireEvent.change(screen.getByLabelText(pt("provenance.lock.label")), {
      target: { value: "legal name" },
    });
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.lock.add") }));
    // 表单校验是异步的：等 onFinish 真的跑完再断言。
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      kind: "name",
      object_id: "exp_1",
      path: "experience.0.company",
      label: "legal name",
    });
  });

  it("解除锁定只是回调", () => {
    const onDelete = vi.fn();
    render(
      <AntdApp>
        <FactLockPanel locks={[LOCK]} onDelete={onDelete} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.lock.remove") }));
    expect(onDelete).toHaveBeenCalledWith(LOCK);
  });

  it("冲突业务码但拿不到逐条违规时，回退通用说明", () => {
    render(
      <AntdApp>
        <FactLockPanel locks={[LOCK]} conflictCode="fact_lock_conflict" />
      </AntdApp>,
    );
    expect(screen.getByText(pt("provenance.lock.conflict"))).toBeTruthy();
    expect(screen.queryByText(pt("provenance.lock.violations"))).toBeNull();
  });

  it("payload 里有逐条违规时逐条展示：锁定值 → 当前值 + 原因", () => {
    const violations: FactLockViolationOut[] = [
      {
        lock_id: 1,
        kind: "institution",
        label: "legal name",
        path: "experience.0.company",
        field: "company",
        reason: "value changed",
        locked_value: "Cloud Commerce Ltd",
        current_value: "Cloud Commerce Limited",
      },
    ];
    render(
      <AntdApp>
        <FactLockPanel locks={[LOCK]} conflictCode="fact_lock_conflict" violations={violations} />
      </AntdApp>,
    );
    expect(screen.getByText(pt("provenance.lock.violations"))).toBeTruthy();
    expect(
      screen.getByText(
        pt("provenance.lock.violationLine", {
          label: "legal name",
          locked: "Cloud Commerce Ltd",
          current: "Cloud Commerce Limited",
        }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(pt("provenance.lock.violationReason", { reason: "value changed" })),
    ).toBeTruthy();
    // 有逐条违规时不再显示通用兜底文案，避免"两条信息互相打架"。
    expect(screen.queryByText(pt("provenance.lock.conflict"))).toBeNull();
  });
});
