// SPDX-License-Identifier: Apache-2.0
/** 全局搜索卡：岗位/简历命中带 id 深链（RF-11 搜索直开）；more 域命中维持后端下发的 path。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, ResumeBrief } from "../../types";
import { SearchCard } from "./SearchCard";

const apiMocks = vi.hoisted(() => ({ searchAll: vi.fn() }));

vi.mock("../../api/search", () => apiMocks);

const JOB: Job = {
  id: 12,
  title: "算法工程师",
  company: "示例科技",
  location: "上海",
  salary: "20k-30k",
  job_type: "社招",
  description: "",
  requirements: "",
  additional_info: "",
  keywords: [],
  source: "手动填写",
  source_url: "",
  posted_at: "",
  status: "开放中",
  note: "",
  note_images: [],
  recognition_source: "",
  origin_source: "",
  favorite: false,
  created_at: "2026-09-01T08:00:00",
  updated_at: "2026-09-01T08:00:00",
};

const RESUME: ResumeBrief = {
  id: 34,
  title: "算法工程师简历",
  job_id: 12,
  job_title: "算法工程师",
  company: "示例科技",
  source: "manual",
  favorite: false,
  note: "",
  model: "",
  enhancement_enabled: false,
  enhancement_level: "balanced",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-09-02T08:00:00",
};

function renderCard() {
  return render(
    <MemoryRouter>
      <SearchCard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMocks.searchAll.mockReset().mockResolvedValue({ jobs: [], resumes: [], more: [] });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SearchCard 带 id 深链（RF-11）", () => {
  it("岗位命中直开该岗位详情（job_id），不再用 keyword 过滤", async () => {
    apiMocks.searchAll.mockResolvedValue({ jobs: [JOB], resumes: [], more: [] });
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/搜索岗位、简历/), {
      target: { value: "算法" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    await waitFor(() => expect(apiMocks.searchAll).toHaveBeenCalled());
    const link = await screen.findByRole("link", { name: "算法工程师" });
    expect(link).toHaveAttribute("href", "/jobs?job_id=12");
  });

  it("简历命中直开该简历详情（resume_id）", async () => {
    apiMocks.searchAll.mockResolvedValue({ jobs: [], resumes: [RESUME], more: [] });
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/搜索岗位、简历/), {
      target: { value: "算法" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    const link = await screen.findByRole("link", { name: "算法工程师简历" });
    expect(link).toHaveAttribute("href", "/resumes?resume_id=34");
  });

  it("more 域命中维持后端下发的 path，不受本批改动影响", async () => {
    apiMocks.searchAll.mockResolvedValue({
      jobs: [],
      resumes: [],
      more: [{ type: "claim", id: 5, title: "召回率提升", subtitle: "", path: "/claims" }],
    });
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/搜索岗位、简历/), {
      target: { value: "召回" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ }));

    const link = await screen.findByRole("link", { name: "召回率提升" });
    expect(link).toHaveAttribute("href", "/claims");
  });
});
