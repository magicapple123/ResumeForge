// SPDX-License-Identifier: Apache-2.0
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGraphViewport } from "./useGraphViewport";

function Harness({ onOpen }: { onOpen: () => void }) {
  const { surfaceRef, view, surfaceProps } = useGraphViewport(1000, 420, true);
  return (
    <div ref={surfaceRef} data-testid="surface" tabIndex={0} {...surfaceProps}>
      <output data-testid="view">{JSON.stringify(view)}</output>
      <button className="rf-job-graph-node" onClick={onOpen}>
        node
      </button>
    </div>
  );
}
afterEach(cleanup);
function view() {
  return JSON.parse(screen.getByTestId("view").textContent || "{}");
}

describe("useGraphViewport", () => {
  it("cancels native wheel zoom and ordinary scrolling, preserving its anchor", async () => {
    render(<Harness onOpen={vi.fn()} />);
    await waitFor(() => expect(view().scale).toBe(0.5));
    const surface = screen.getByTestId("surface");
    const before = view();
    const wheel = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      surface.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(view().scale).toBe(0.6);
    expect((200 - view().x) / view().scale).toBeCloseTo((200 - before.x) / before.scale, 10);
    const pan = new WheelEvent("wheel", {
      deltaX: 12,
      deltaY: 25,
      bubbles: true,
      cancelable: true,
    });
    const zoomed = view();
    act(() => {
      surface.dispatchEvent(pan);
    });
    expect(pan.defaultPrevented).toBe(true);
    expect(view().x).toBe(zoomed.x - 12);
    expect(view().y).toBe(zoomed.y - 25);
  });
  it("suppresses node activation after a drag over four pixels, then allows a normal click", async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    await waitFor(() => expect(view().scale).toBe(0.5));
    const surface = screen.getByTestId("surface");
    surface.setPointerCapture = vi.fn();
    surface.hasPointerCapture = () => true;
    surface.releasePointerCapture = vi.fn();
    const node = screen.getByRole("button", { name: "node" });
    fireEvent.pointerDown(node, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    fireEvent.click(node);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.pointerDown(node, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 14, clientY: 10 });
    fireEvent.pointerUp(node, { pointerId: 2 });
    fireEvent.click(node);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("pans and zooms from the focused canvas keyboard", async () => {
    render(<Harness onOpen={vi.fn()} />);
    await waitFor(() => expect(view().scale).toBe(0.5));
    const surface = screen.getByTestId("surface");
    const before = view();
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(view().x).toBe(before.x - 40);
    fireEvent.keyDown(surface, { key: "+" });
    expect(view().scale).toBe(0.6);
  });
});
