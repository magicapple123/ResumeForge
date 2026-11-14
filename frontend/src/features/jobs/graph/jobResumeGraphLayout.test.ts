// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { jobResumeGraphLayout, type GraphResume } from "./jobResumeGraphLayout";
import { zoomGraphAt } from "./useGraphViewport";

function resume(id: number, kind: GraphResume["kind"], day: number): GraphResume {
  return { id, kind, title: String(id), updatedAt: "2026-11-" + String(day).padStart(2, "0") };
}

describe("jobResumeGraphLayout", () => {
  it("sorts recent first within sources and interleaves with stable source-qualified ids", () => {
    const graph = jobResumeGraphLayout(
      [resume(1, "internal", 1), resume(2, "internal", 3)],
      [resume(1, "external", 4), resume(3, "external", 2)],
    );
    expect(graph.nodes.map((node) => node.key)).toEqual([
      "external:1",
      "internal:2",
      "external:3",
      "internal:1",
    ]);
    expect(graph.nodes.map((node) => node.x)).toEqual([20, 720, 20, 720]);
    expect(graph.nodes[0].edge).toBe("M 410 210 C 345 210, 345 164, 280 164");
    expect(graph.nodes[1].edge).toBe("M 590 210 C 655 210, 655 164, 720 164");
  });
  it("keeps the latest 60 and a separate true total", () => {
    const graph = jobResumeGraphLayout(
      Array.from({ length: 80 }, (_, i) => resume(i, "internal", 1)),
      [],
    );
    expect(graph.total).toBe(80);
    expect(graph.nodes).toHaveLength(60);
    expect(graph.nodes[0].id).toBe(79);
    expect(graph.nodes[59].id).toBe(20);
  });
  it("caps globally before interleaving so an older source cannot displace recent resumes", () => {
    const graph = jobResumeGraphLayout(
      [resume(999, "internal", 1)],
      Array.from({ length: 61 }, (_, i) => resume(i, "external", 3)),
    );
    expect(graph.total).toBe(62);
    expect(graph.nodes).toHaveLength(60);
    expect(graph.nodes.every((node) => node.kind === "external")).toBe(true);
    expect(graph.nodes.map((node) => node.id)).toEqual(
      Array.from({ length: 60 }, (_, i) => 60 - i),
    );
  });
  it("has a centered job and no stray edges for an empty job", () => {
    const graph = jobResumeGraphLayout([], []);
    expect(graph.nodes).toEqual([]);
    expect(graph.job).toEqual({ x: 410, y: 160, width: 180, height: 100 });
  });
});

describe("zoomGraphAt", () => {
  it("preserves the pointer anchor and clamps scale to 0.5–2.0", () => {
    const view = { x: 40, y: -10, scale: 1 };
    const zoomed = zoomGraphAt(view, 1.1, 240, 190);
    expect(zoomed).toEqual({ x: 19.99999999999997, y: -30.00000000000003, scale: 1.1 });
    expect((240 - zoomed.x) / zoomed.scale).toBeCloseTo(200, 10);
    expect((190 - zoomed.y) / zoomed.scale).toBeCloseTo(200, 10);
    expect(zoomGraphAt(view, 9, 0, 0).scale).toBe(2);
    expect(zoomGraphAt(view, -9, 0, 0).scale).toBe(0.5);
  });
});
