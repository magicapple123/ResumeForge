import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listSkills } from "../api/skill";
import SkillsPage from "./SkillsPage";

vi.mock("../api/skill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/skill")>()),
  listSkills: vi.fn(),
}));

afterEach(cleanup);

describe("workbench loading states", () => {
  it("offers retry after failure and shows the empty state only after a successful read", async () => {
    vi.mocked(listSkills)
      .mockRejectedValueOnce(new Error("本地服务暂不可用"))
      .mockResolvedValue([]);
    render(
      <AntdApp>
        <SkillsPage />
      </AntdApp>,
    );
    const failure = await screen.findByText("技能加载失败：本地服务暂不可用");
    expect(failure.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText("还没有技能，先用模板建一个试试")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    expect(await screen.findByText("还没有技能，先用模板建一个试试")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/技能加载失败/)).toBeNull());
  });
});
