// SPDX-License-Identifier: Apache-2.0
/**
 * F36：气泡里的「本轮引用」。
 *
 * 三条性质：只显示已选的那一个（没选就不渲染整行，也不多出空白段）；标题用后端快照；
 * 传了跳转回调才可点、才进无障碍树（浮动形态与单测不传 → 退化成只读标签）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import MessageReferences from "./MessageReferences";

describe("message references (F36)", () => {
  it("renders nothing when the message referenced neither a job nor a resume", () => {
    const { container } = render(<MessageReferences refs={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the job as `title · company` and the resume title", () => {
    render(
      <MessageReferences
        refs={{
          job_id: 7,
          job_title: "Growth Ops",
          job_company: "Acme",
          resume_id: 9,
          resume_title: "Growth resume",
        }}
      />,
    );
    expect(screen.getByText(t("assistantUi.messageRefs.label"))).toBeTruthy();
    expect(screen.getByText("Growth Ops · Acme")).toBeTruthy();
    expect(screen.getByText("Growth resume")).toBeTruthy();
  });

  it("only renders the selection that exists", () => {
    const { container } = render(
      <MessageReferences refs={{ job_id: 7, job_title: "Growth Ops" }} />,
    );
    expect(screen.getByText("Growth Ops")).toBeTruthy();
    // 没选简历时不该出现第二个 chip（空标签会让人以为简历丢了）。
    expect(container.querySelectorAll(".assistant-ref-chip")).toHaveLength(1);
  });

  it("falls back to the id label for messages stored before titles were snapshotted", () => {
    render(<MessageReferences refs={{ job_id: 7, resume_id: 9 }} />);
    expect(screen.getByText(t("assistantComposer.context.jobFallback", { id: 7 }))).toBeTruthy();
    expect(screen.getByText(t("assistantComposer.context.resumeFallback", { id: 9 }))).toBeTruthy();
  });

  it("stays a plain label when no navigation callback is given", () => {
    render(<MessageReferences refs={{ job_id: 7, job_title: "Growth Ops" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens the referenced job/resume by click and by keyboard", () => {
    const onOpenReference = vi.fn();
    render(
      <MessageReferences
        refs={{ job_id: 7, job_title: "Growth Ops", resume_id: 9, resume_title: "Growth resume" }}
        onOpenReference={onOpenReference}
      />,
    );
    const [jobChip, resumeChip] = screen.getAllByRole("link");
    fireEvent.click(jobChip);
    expect(onOpenReference).toHaveBeenCalledWith("job", 7);
    fireEvent.keyDown(resumeChip, { key: "Enter" });
    expect(onOpenReference).toHaveBeenCalledWith("resume", 9);
  });
});
