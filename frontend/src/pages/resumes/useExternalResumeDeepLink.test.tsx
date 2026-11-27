// SPDX-License-Identifier: Apache-2.0
/**
 * `useExternalResumeDeepLink`：把 `?resume=<id>` 消费成"打开那一份详情"（T31 续）。
 *
 * 这里钉住四条互相牵连的规则（详见 hook 顶部文档串）：
 *
 * 1. 命中且这条简历还在 → `getExternalResume(id)` + `onOpen(id)`，参数从 URL 删掉，
 *    且必须是 `replace`（不往浏览器历史里塞一条）；
 * 2. 接口 404（不存在 / 已进回收站）→ `onMissing()`，**不打开**详情；
 * 3. 参数非法（`abc` / 内部简历引用）→ `onMissing()`，且**不发请求**；
 * 4. 同一个参数值只处理一次：删参数会让 effect 重跑，重跑不能再请求一次。
 *
 * 断言走 `data-testid` / 调用计数，不写 `*ByText` 的中文——cjkRatchet 对新增测试文件
 * 的基线是 0。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseExternalResumeParam, useExternalResumeDeepLink } from "./useExternalResumeDeepLink";

const apiMocks = vi.hoisted(() => ({ getExternalResume: vi.fn() }));

vi.mock("../../api/externalResumes", () => apiMocks);

interface Handlers {
  onOpen: (id: number) => void;
  onMissing: () => void;
}

/** 只挂 hook，不渲染界面：这条链路的状态都在 URL 与回调里。 */
function Harness({ onOpen, onMissing }: Handlers) {
  useExternalResumeDeepLink({ onOpen, onMissing });
  return null;
}

/** 把当前 `location.search` 与导航类型打出来，供断言读取。 */
function Probe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <div data-testid="search">{location.search}</div>
      <div data-testid="navtype">{navigationType}</div>
    </>
  );
}

function renderDeepLink(entry: string, handlers: Handlers) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Harness {...handlers} />
      <Probe />
    </MemoryRouter>,
  );
}

const searchText = () => screen.getByTestId("search").textContent ?? "";

beforeEach(() => {
  apiMocks.getExternalResume.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("parseExternalResumeParam", () => {
  it("accepts a plain id and external refs, rejects everything else", () => {
    expect(parseExternalResumeParam("8")).toBe(8);
    expect(parseExternalResumeParam("external:8")).toBe(8);
    expect(parseExternalResumeParam("e:8")).toBe(8);
    // 空 / 缺省 / 非正数 / 小数 / 非数字：一律 null。
    expect(parseExternalResumeParam(null)).toBeNull();
    expect(parseExternalResumeParam("")).toBeNull();
    expect(parseExternalResumeParam("   ")).toBeNull();
    expect(parseExternalResumeParam("0")).toBeNull();
    expect(parseExternalResumeParam("-1")).toBeNull();
    expect(parseExternalResumeParam("1.5")).toBeNull();
    expect(parseExternalResumeParam("abc")).toBeNull();
    expect(parseExternalResumeParam("external:0")).toBeNull();
    // 内部简历的深链属于 /resumes?resume_id=，在外部页里不成立。
    expect(parseExternalResumeParam("internal:8")).toBeNull();
    expect(parseExternalResumeParam("r:8")).toBeNull();
  });
});

describe("useExternalResumeDeepLink", () => {
  it("opens the resume and consumes the param with replace", async () => {
    apiMocks.getExternalResume.mockResolvedValue({ id: 8 });
    const onOpen = vi.fn();
    const onMissing = vi.fn();

    renderDeepLink("/resumes/external?resume=8", { onOpen, onMissing });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(8));
    expect(apiMocks.getExternalResume).toHaveBeenCalledWith(8);
    expect(onMissing).not.toHaveBeenCalled();
    await waitFor(() => expect(searchText()).toBe(""));
    // 参数是被 replace 掉的：导航类型是 REPLACE，不是 PUSH。
    expect(screen.getByTestId("navtype").textContent).toBe("REPLACE");
  });

  it("reports missing when the resume no longer exists", async () => {
    apiMocks.getExternalResume.mockRejectedValue(new Error("404"));
    const onOpen = vi.fn();
    const onMissing = vi.fn();

    renderDeepLink("/resumes/external?resume=99999", { onOpen, onMissing });

    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(searchText()).toBe(""));
  });

  it.each(["abc", "internal:8"])(
    "reports missing for the malformed param %s without calling the API",
    async (raw) => {
      const onOpen = vi.fn();
      const onMissing = vi.fn();

      renderDeepLink(`/resumes/external?resume=${encodeURIComponent(raw)}`, { onOpen, onMissing });

      await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
      expect(apiMocks.getExternalResume).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
      await waitFor(() => expect(searchText()).toBe(""));
    },
  );

  it("processes the same param value only once", async () => {
    apiMocks.getExternalResume.mockResolvedValue({ id: 8 });
    const onOpen = vi.fn();
    const onMissing = vi.fn();
    const handlers = { onOpen, onMissing };

    const view = renderDeepLink("/resumes/external?resume=8", handlers);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(searchText()).toBe("");

    // 再渲染一次：URL 已经被消费，effect（因删除参数而重跑）不能再请求第二次。
    view.rerender(
      <MemoryRouter initialEntries={["/resumes/external?resume=8"]}>
        <Harness {...handlers} />
        <Probe />
      </MemoryRouter>,
    );

    expect(searchText()).toBe("");
    expect(apiMocks.getExternalResume).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMissing).not.toHaveBeenCalled();
  });
});
