/**
 * 岗位详情抽屉：来源不在投递台支持的招聘网站内时，「加入投递台」必须是灰的，且**把原因写在页面上**。
 *
 * 这条来自用户反馈：手动录入的岗位以前也能加进投递队列，强行开始投递只会得到一条「未知失败」。
 * 现在闸门在后端，界面负责"别让用户点了才被拒"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Job } from "../types";
import JobDetailDrawer from "./JobDetailDrawer";

const BASE_JOB: Job = {
  id: 1,
  title: "护士",
  company: "示例医院",
  location: "杭州市余杭区",
  salary: "",
  job_type: "社招",
  description: "负责病区护理工作。",
  requirements: "持有护士执业资格证。",
  additional_info: "",
  keywords: [],
  source: "BOSS直聘",
  source_url: "https://www.zhipin.com/job/1",
  posted_at: "2026年8月20日",
  status: "开放中",
  note: "",
  note_images: [],
  recognition_source: "",
  origin_source: "",
  favorite: false,
  apply_supported: true,
  created_at: "2026-08-19T08:00:00",
  updated_at: "2026-08-21T09:30:00",
};

function renderDrawer(job: Job) {
  const noop = () => undefined;
  return render(
    <AntdApp>
      {/* 抽屉内的跨模块动作直接 navigate（RF-11），渲染必须在 Router 上下文里。 */}
      <MemoryRouter>
        <JobDetailDrawer
          job={job}
          onClose={noop}
          onGenerate={noop}
          onWrite={noop}
          onViewResumes={noop}
          onAnalyze={noop}
          onMatch={noop}
          onAddToQueue={noop}
          onAskAssistant={noop}
          onFavorite={noop}
          onOpenWebForm={noop}
        />
      </MemoryRouter>
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JobDetailDrawer 投递来源闸门", () => {
  it("来源受支持时可点「加入投递台」，且不显示拦截说明", () => {
    renderDrawer({ ...BASE_JOB, apply_supported: true });

    expect(screen.getByRole("button", { name: /加入投递台/ })).toBeEnabled();
    expect(screen.queryByText("这个岗位不能用投递台自动投递")).not.toBeInTheDocument();
  });

  it("来源不受支持时按钮禁用，并把原因写在页面上（不是只给一个灰按钮）", () => {
    renderDrawer({
      ...BASE_JOB,
      source: "手动添加",
      source_url: "",
      apply_supported: false,
    });

    expect(screen.getByRole("button", { name: /加入投递台/ })).toBeDisabled();
    expect(screen.getByText("这个岗位不能用投递台自动投递")).toBeInTheDocument();
    // 说明里要给出出路：补上招聘网站的投递链接，或自行投递。
    expect(screen.getByText(/投递链接/)).toBeInTheDocument();
  });

  it("后端没带这个字段时按「可以投」处理，不把能干的事藏起来", () => {
    const job = { ...BASE_JOB };
    delete job.apply_supported;

    renderDrawer(job);

    expect(screen.getByRole("button", { name: /加入投递台/ })).toBeEnabled();
  });

  it("点击可用状态下会回调 onAddToQueue", () => {
    const onAddToQueue = vi.fn();
    const noop = () => undefined;
    render(
      <AntdApp>
        <MemoryRouter>
          <JobDetailDrawer
            job={{ ...BASE_JOB, apply_supported: true }}
            onClose={noop}
            onGenerate={noop}
            onWrite={noop}
            onViewResumes={noop}
            onAnalyze={noop}
            onMatch={noop}
            onAddToQueue={onAddToQueue}
            onAskAssistant={noop}
            onFavorite={noop}
            onOpenWebForm={noop}
          />
        </MemoryRouter>
      </AntdApp>,
    );

    screen.getByRole("button", { name: /加入投递台/ }).click();

    expect(onAddToQueue).toHaveBeenCalledOnce();
  });

  it("打开网申时禁用按钮并显示加载态，避免重复拉起浏览器", () => {
    renderDrawer({ ...BASE_JOB, source_url: "https://example.com/apply" });

    const button = screen.getByRole("button", { name: /前往投递/ });
    expect(button).toBeEnabled();

    cleanup();
    render(
      <AntdApp>
        <MemoryRouter>
          <JobDetailDrawer
            job={BASE_JOB}
            onClose={() => undefined}
            onGenerate={() => undefined}
            onWrite={() => undefined}
            onViewResumes={() => undefined}
            onAnalyze={() => undefined}
            onMatch={() => undefined}
            onAddToQueue={() => undefined}
            onAskAssistant={() => undefined}
            onFavorite={() => undefined}
            onOpenWebForm={() => undefined}
            webFormLoading
          />
        </MemoryRouter>
      </AntdApp>,
    );

    expect(screen.getByRole("button", { name: /前往投递/ })).toBeDisabled();
  });
});

describe("JobDetailDrawer 带 id 的跨模块动作（RF-11）", () => {
  function LocationProbe() {
    const location = useLocation();
    return <span data-testid="location">{location.pathname + location.search}</span>;
  }

  function renderWithProbe(job: Job) {
    const noop = () => undefined;
    return render(
      <AntdApp>
        <MemoryRouter>
          <JobDetailDrawer
            job={job}
            onClose={noop}
            onGenerate={noop}
            onWrite={noop}
            onViewResumes={noop}
            onAnalyze={noop}
            onMatch={noop}
            onAddToQueue={noop}
            onAskAssistant={noop}
            onFavorite={noop}
            onOpenWebForm={noop}
          />
          <LocationProbe />
        </MemoryRouter>
      </AntdApp>,
    );
  }

  it("「该岗位的投递进度」携带 job_id 跳到求职进度", () => {
    renderWithProbe({ ...BASE_JOB, id: 42 });

    fireEvent.click(screen.getByRole("button", { name: /该岗位的投递进度/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/tracker?job_id=42");
  });

  it("「模拟面试」携带 job_id 跳到模拟面试", () => {
    renderWithProbe({ ...BASE_JOB, id: 42 });

    fireEvent.click(screen.getByRole("button", { name: /模拟面试/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/interview?job_id=42");
  });
});

describe("JobDetailDrawer 来源字段", () => {
  it("填写了来源时独立展示，备注正文里不再有「来源：…」行", () => {
    renderDrawer({ ...BASE_JOB, origin_source: "内推", note: "王工帮我递的简历" });

    expect(screen.getByText("内推")).toBeInTheDocument();
    expect(screen.getByText("王工帮我递的简历")).toBeInTheDocument();
  });

  it("没填来源时整行不渲染（空值不占一行，避免和「录入方式」看起来重复）", () => {
    renderDrawer(BASE_JOB);

    expect(screen.queryByText("来源")).not.toBeInTheDocument();
  });

  it("「录入方式」始终展示系统记录的录入途径", () => {
    renderDrawer({ ...BASE_JOB, recognition_source: "粘贴文本识别" });

    expect(screen.getByText("粘贴文本识别")).toBeInTheDocument();
  });
});
