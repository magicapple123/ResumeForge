import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => vi.fn());
vi.mock("../api/datasetScope", () => ({ initializeDatasetScope: bootstrap }));
import DatasetScopeBoundary from "./DatasetScopeBoundary";

afterEach(() => {
  cleanup();
  bootstrap.mockReset();
});

describe("DatasetScopeBoundary", () => {
  it("does not mount editable content until its dataset identity has been confirmed", async () => {
    let resolve!: () => void;
    bootstrap.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(
      <DatasetScopeBoundary>
        <button>editable</button>
      </DatasetScopeBoundary>,
    );
    expect(screen.queryByText("editable")).toBeNull();
    await act(async () => resolve());
    expect(screen.getByText("editable")).toBeTruthy();
  });
  it("shows a service failure without opening editable pages", async () => {
    bootstrap.mockRejectedValue(new Error("synthetic unavailable"));
    render(
      <DatasetScopeBoundary>
        <button>editable</button>
      </DatasetScopeBoundary>,
    );
    expect(await screen.findByText("无法连接本地工作台")).toBeTruthy();
    expect(screen.queryByText("editable")).toBeNull();
    expect(screen.getByRole("button", { name: /刷\s*新/ })).toBeTruthy();
  });
  it("aborts bootstrap on unmount so late responses cannot open another page", () => {
    bootstrap.mockImplementation(() => new Promise(() => {}));
    const view = render(
      <DatasetScopeBoundary>
        <button>editable</button>
      </DatasetScopeBoundary>,
    );
    const signal = bootstrap.mock.calls[0][0] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
