// SPDX-License-Identifier: Apache-2.0
/**
 * 参数分组壳（简历制作台左栏四组的共用外壳）：折叠 + 偏好持久化（P1-3）。
 *
 * 这条需求只有一个可观测判据——**刷新之后折叠状态还在**。它很容易做成"看着能折叠、
 * 刷新就忘了"，而用户对它的感受是"每次打开都要重新折叠一遍"。
 *
 * 另外钉住两条边界：
 * - 偏好存 `localStorage`（`resume.wb.group.*`），**不能**与编辑草稿（`sessionStorage` 的
 *   `resume.edit#…`）混用：清了草稿不该把分组全展开；
 * - 存不进去（隐私模式 `localStorage` 抛异常）时只在本次会话生效，不能整栏渲染失败。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumeParamGroup from "./ResumeParamGroup";

const TITLE = "Group title for tests";
const BODY = "group-body-marker";

function renderGroup(props: { storageKey?: string; defaultOpen?: boolean } = {}) {
  return render(
    <ResumeParamGroup title={TITLE} storageKey={props.storageKey ?? "measure"}>
      <span>{BODY}</span>
    </ResumeParamGroup>,
  );
}

function toggle(): HTMLElement {
  return screen.getByRole("button", { name: TITLE });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ResumeParamGroup", () => {
  it("默认展开，点标题收起（内容卸载而不是只隐藏）", () => {
    renderGroup();

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(BODY)).toBeInTheDocument();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(BODY)).not.toBeInTheDocument();
  });

  it("折叠状态写进 localStorage，重新挂载后仍然收起（P1-3 的验收口径）", () => {
    renderGroup();
    fireEvent.click(toggle());
    expect(window.localStorage.getItem("resume.wb.group.measure")).toBe("0");

    cleanup();
    renderGroup();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(BODY)).not.toBeInTheDocument();
  });

  it("默认展开的偏好也会被落下来（首次渲染就写）", () => {
    renderGroup();

    // 写下默认值，是为了以后调 `defaultOpen` 时不会悄悄改变已有用户的界面。
    expect(window.localStorage.getItem("resume.wb.group.measure")).toBe("1");
  });

  it("不同分组各存一份偏好，互不影响", () => {
    renderGroup({ storageKey: "layout" });
    fireEvent.click(toggle());

    cleanup();
    renderGroup({ storageKey: "appearance" });

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("resume.wb.group.layout")).toBe("0");
  });

  it("偏好存不进去（隐私模式抛异常）时不影响渲染", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    renderGroup();

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(BODY)).toBeInTheDocument();
    // 本次会话里折叠照常可用。
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});
