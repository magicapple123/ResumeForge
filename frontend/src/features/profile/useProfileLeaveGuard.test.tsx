// SPDX-License-Identifier: Apache-2.0
/** 离开守卫（F6 / R-26）：SPA 路由离开、程序触发切组、取消编辑共用同一出口。 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProfileLeaveGuard } from "./useProfileLeaveGuard";

function GuardHarness({ dirty, action }: { dirty: boolean; action: () => void }) {
  const guard = useProfileLeaveGuard({ dirty });
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="confirm-open">{guard.confirmOpen ? "open" : "closed"}</span>
      <span data-testid="pending-kind">{guard.pendingKind ?? "none"}</span>
      <button onClick={() => navigate("/other")}>go-other</button>
      <button onClick={() => guard.requestLeave("cancel", action)}>request-cancel</button>
      <button onClick={() => guard.requestLeave("switch-group", action)}>request-switch</button>
      <button onClick={() => guard.confirmDiscard()}>confirm-discard</button>
      <button onClick={() => guard.cancelDiscard()}>cancel-discard</button>
    </div>
  );
}

function renderRouter(dirty: boolean, action: () => void = vi.fn()) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <GuardHarness dirty={dirty} action={action} /> },
      { path: "/other", element: <div>other-page</div> },
    ],
    { initialEntries: ["/"] },
  );
  const view = render(<RouterProvider router={router as never} />);
  return { ...view, router };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useProfileLeaveGuard", () => {
  it("navigates freely when nothing is dirty", async () => {
    const { router } = renderRouter(false);
    fireEvent.click(screen.getByText("go-other"));
    expect(await screen.findByText("other-page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/other");
  });

  it("blocks SPA navigation while dirty and keeps the page until confirmed", async () => {
    const { router } = renderRouter(true);
    fireEvent.click(screen.getByText("go-other"));

    expect(await screen.findByTestId("confirm-open")).toHaveTextContent("open");
    expect(screen.getByTestId("pending-kind")).toHaveTextContent("navigate");
    expect(router.state.location.pathname).toBe("/");

    fireEvent.click(screen.getByText("cancel-discard"));
    expect(screen.getByTestId("confirm-open")).toHaveTextContent("closed");
    expect(router.state.location.pathname).toBe("/");

    fireEvent.click(screen.getByText("go-other"));
    fireEvent.click(await screen.findByText("confirm-discard"));
    expect(await screen.findByText("other-page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/other");
  });

  it("runs a requested leave action immediately when clean", () => {
    const action = vi.fn();
    renderRouter(false, action);
    fireEvent.click(screen.getByText("request-cancel"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("confirm-open")).toHaveTextContent("closed");
  });

  it("defers programmatic leave (cancel / switch group) until the user confirms", () => {
    const action = vi.fn();
    const { router } = renderRouter(true, action);

    fireEvent.click(screen.getByText("request-cancel"));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByTestId("pending-kind")).toHaveTextContent("cancel");

    fireEvent.click(screen.getByText("cancel-discard"));
    expect(action).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/");

    fireEvent.click(screen.getByText("request-switch"));
    expect(screen.getByTestId("pending-kind")).toHaveTextContent("switch-group");
    fireEvent.click(screen.getByText("confirm-discard"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/");
  });

  it("mounts the beforeunload guard only while dirty", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const view = renderRouter(true);
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    view.unmount();
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("declarative router fallback", () => {
  it("does not crash the page when rendered outside a data router", () => {
    const action = vi.fn();
    expect(() =>
      render(
        <MemoryRouter>
          <GuardHarness dirty action={action} />
        </MemoryRouter>,
      ),
    ).not.toThrow();
    // 没有 data router 时不能提供 SPA 拦截，但确认流与 beforeunload 仍可用。
    expect(screen.getByTestId("confirm-open")).toHaveTextContent("closed");
    fireEvent.click(screen.getByText("request-cancel"));
    expect(screen.getByTestId("confirm-open")).toHaveTextContent("open");
    fireEvent.click(screen.getByText("confirm-discard"));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
