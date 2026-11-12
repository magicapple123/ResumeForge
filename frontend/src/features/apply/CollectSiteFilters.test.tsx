// SPDX-License-Identifier: Apache-2.0
/**
 * 站点侧筛选项：清单渲染、多选/单选能力、兼职联动、来源标注、选中值进入表单、读不到时降级。
 *
 * 这一块最容易出的错是**静默失效**——用户选了一个条件、界面看着也选了，实际没生效。
 * 所以用例的重点不在"能不能渲染"，而在：
 *
 * - 选中的编码是否真的进了表单值（多选是数组、单选是单值）；
 * - 站点能力表（多选组 / 单选组 / 兼职联动）是否按后端下发的规则生效，切走时残留值是否清掉；
 * - 来源是否如实标注。
 *
 * 文案断言一律走 t()/role：i18n 棘轮要求测试里的中文 ByText 只降不升（cjkRatchet）。
 */
import { App as AntdApp, Button, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectFilterGroup, CollectFilterOptions } from "../../types";
import { t } from "../../i18n";
import CollectSiteFilters from "./CollectSiteFilters";

const apiMocks = vi.hoisted(() => ({
  getCollectFilterOptions: vi.fn(),
  testCollectFilters: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  getCollectFilterOptions: apiMocks.getCollectFilterOptions,
  testCollectFilters: apiMocks.testCollectFilters,
}));

/** 分组是站点提供的，label 就是后端下发的中文——测试里当数据用，不作文案断言。 */
const JOB_TYPE = "求职类型";
const SALARY = "薪资待遇";
const PAY_TYPE = "结算方式";
const PART_TIME = "兼职时间";
const DEGREE = "学历要求";
const INDUSTRY = "公司行业";

const aria = (label: string) => t("collectFilters.aria.group", { label });

/** 一份与后端能力表同形的清单：jobType/salary 单选、其余多选，兼职联动两组。 */
function groups(sessionRead: boolean): CollectFilterGroup[] {
  const source = sessionRead ? "session" : "public";
  const options = (pairs: [string, string][]) =>
    pairs.map(([code, label]) => ({ code, label, group: "" }));
  return [
    {
      key: "jobType",
      param: "jobType",
      label: JOB_TYPE,
      source,
      note: "",
      multi: false,
      visible_when: null,
      options: options([
        ["0", "不限"],
        ["1901", "全职"],
        ["1902", "实习"],
        ["1903", "兼职"],
      ]),
    },
    {
      key: "salary",
      param: "salary",
      label: SALARY,
      source,
      note: "",
      multi: false,
      visible_when: { key: "jobType", values: ["", "0", "1901", "1902"] },
      options: options([
        ["0", "不限"],
        ["405", "10-20K"],
      ]),
    },
    {
      key: "payType",
      param: "payType",
      label: PAY_TYPE,
      source,
      note: "",
      multi: true,
      visible_when: { key: "jobType", values: ["1903"] },
      options: options([
        ["0", "不限"],
        ["2503", "月结"],
        ["2504", "完工结"],
      ]),
    },
    {
      key: "partTime",
      param: "partTime",
      label: PART_TIME,
      source,
      note: "",
      multi: true,
      visible_when: { key: "jobType", values: ["1903"] },
      options: options([
        ["0", "不限"],
        ["2701", "周末/节假日"],
        ["2702", "寒暑假"],
      ]),
    },
    {
      key: "degree",
      param: "degree",
      label: DEGREE,
      source,
      note: "",
      multi: true,
      visible_when: null,
      options: options([
        ["0", "不限"],
        ["202", "大专"],
        ["203", "本科"],
      ]),
    },
    {
      key: "industry",
      param: "industry",
      label: INDUSTRY,
      source: "public",
      note: "",
      multi: true,
      visible_when: null,
      options: [
        { code: "100020", label: "互联网", group: "互联网/AI" },
        { code: "100028", label: "人工智能", group: "互联网/AI" },
        { code: "101405", label: "半导体/芯片", group: "电子/通信/半导体" },
      ],
    },
  ];
}

function options(sessionRead: boolean): CollectFilterOptions {
  return {
    site_key: "boss",
    display_name: "BOSS直聘",
    session_read: sessionRead,
    groups: groups(sessionRead),
  };
}

/** 组件是给 Form.Item 用的，必须放在 Form 里；提交后把整份表单值交出来断言。 */
function renderFilters(
  onValues: (values: Record<string, unknown>) => void = () => {},
  initialFilters: Record<string, unknown> = {},
) {
  return render(
    <AntdApp>
      <Form onFinish={onValues} initialValues={{ filters: initialFilters }}>
        <CollectSiteFilters
          disabled={false}
          getFilters={() => ({ jobType: ["1902"], industry: ["100020"] })}
        />
        <Button htmlType="submit">submit-for-test</Button>
      </Form>
    </AntdApp>,
  );
}

/** 打开某个分组的下拉框并点选一个选项（多选时下拉框不会自动收起）。 */
async function pick(groupLabel: string, optionLabel: string) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: aria(groupLabel) }), {
    button: 0,
  });
  const option = await screen.findByText(
    (content, element) => content === optionLabel && !!element?.closest(".ant-select-item-option"),
  );
  fireEvent.click(option);
}

/** 触发 Form 提交（antd 的 Button 在测试环境里用 role 查询不稳，直接提交 form 更可靠）。 */
function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("找不到 form");
  fireEvent.submit(form);
}

function submitted(onValues: ReturnType<typeof vi.fn>, call = -1) {
  const calls = onValues.mock.calls as [Record<string, unknown>][] | undefined;
  if (!calls || calls.length === 0) return {} as Record<string, unknown>;
  const index = call < 0 ? calls.length + call : call;
  const values = calls[index]?.[0] as { filters?: Record<string, unknown> } | undefined;
  return values?.filters ?? {};
}

const bodyText = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getCollectFilterOptions.mockResolvedValue(options(true));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("CollectSiteFilters", () => {
  it("按后端给的清单渲染下拉框，标题就是站点筛选栏的叫法", async () => {
    renderFilters();
    expect(await screen.findByText(t("collectFilters.section.title"))).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: aria(INDUSTRY) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: aria(DEGREE) })).toBeInTheDocument();
  });

  it("单选组渲染成单选、多选组渲染成多选（能力由后端下发，前端不写死）", async () => {
    const { container } = renderFilters();
    await screen.findByRole("combobox", { name: aria(JOB_TYPE) });
    // 默认（未选求职类型）可见：jobType/salary 单选、degree/industry 多选 → 两个多选框。
    expect(container.querySelectorAll(".ant-select-multiple")).toHaveLength(2);
  });

  it("单选组选中的是单值：只进表单一个编码", async () => {
    const onValues = vi.fn();
    renderFilters(onValues);

    await pick(JOB_TYPE, "实习");
    submitForm();

    await waitFor(() => expect(onValues).toHaveBeenCalled());
    expect(submitted(onValues)).toMatchObject({ jobType: "1902" });
  });

  it("多选组可以把两个编码一起选进表单（学历：大专 + 本科）", async () => {
    const onValues = vi.fn();
    renderFilters(onValues);

    await pick(DEGREE, "大专");
    await pick(DEGREE, "本科");
    submitForm();

    await waitFor(() => expect(onValues).toHaveBeenCalled());
    expect(submitted(onValues).degree).toEqual(["202", "203"]);
  });

  it("行业选项按一级分组展示，不铺成一长条", async () => {
    renderFilters();
    fireEvent.mouseDown(await screen.findByRole("combobox", { name: aria(INDUSTRY) }), {
      button: 0,
    });
    const groupLabel = await screen.findByText(
      (content, element) => content === "互联网/AI" && !!element?.closest(".ant-select-item-group"),
    );
    expect(groupLabel).toBeInTheDocument();
  });

  it("兼职模式：薪资待遇消失、出现结算方式与兼职时间；切回全职恢复", async () => {
    renderFilters(() => {}, { jobType: "1903" });
    expect(await screen.findByRole("combobox", { name: aria(PAY_TYPE) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: aria(PART_TIME) })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: aria(SALARY) })).toBeNull();

    await pick(JOB_TYPE, "全职");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: aria(SALARY) })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("combobox", { name: aria(PAY_TYPE) })).toBeNull();
    expect(screen.queryByRole("combobox", { name: aria(PART_TIME) })).toBeNull();
  });

  it("切到兼职时清空薪资残留值，切走时清空结算方式残留值", async () => {
    const onValues = vi.fn();
    renderFilters(onValues, { jobType: "1901", salary: "405", payType: ["2503"] });

    // 初始是「全职」：薪资可见、结算方式隐藏 → 隐藏组的历史值被清掉。
    await screen.findByRole("combobox", { name: aria(SALARY) });
    submitForm();
    await waitFor(() => expect(onValues).toHaveBeenCalled());
    expect(submitted(onValues).payType).toBeUndefined();
    expect(submitted(onValues).salary).toBe("405");

    // 切到兼职：薪资组消失，残留值必须清掉。
    await pick(JOB_TYPE, "兼职");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: aria(PAY_TYPE) })).toBeInTheDocument(),
    );
    submitForm();
    await waitFor(() => expect(onValues.mock.calls.length).toBeGreaterThan(1));
    expect(submitted(onValues).salary).toBeUndefined();
  });

  it("读到登录态清单时标「读取自你的登录会话」，且不提示去启动浏览器", async () => {
    renderFilters();
    expect(await screen.findByText(t("collectFilters.source.session.text"))).toBeInTheDocument();
    expect(bodyText()).not.toContain(t("collectFilters.launch.title"));
  });

  it("只有公共清单时如实标注，并说明启动浏览器能拿到账号可见的完整选项", async () => {
    apiMocks.getCollectFilterOptions.mockResolvedValue(options(false));
    renderFilters();
    expect(await screen.findByText(t("collectFilters.source.public.text"))).toBeInTheDocument();
    expect(bodyText()).toContain(t("collectFilters.launch.title"));
  });

  it("能力说明写清「哪些单选、哪些多选、兼职联动」与「条件越多覆盖越杂」", async () => {
    renderFilters();
    expect(await screen.findByText(t("collectFilters.intro.rules"))).toBeInTheDocument();
    expect(bodyText()).toContain(t("collectFilters.intro.breadth"));
  });

  it("接口失败时降级成一条提示，不把整个采集表单挡住", async () => {
    apiMocks.getCollectFilterOptions.mockRejectedValue(new Error("接口挂了"));
    renderFilters();
    expect(await screen.findByText(t("collectFilters.unread.title"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(t("collectFilters.action.reload")) }),
    ).toBeInTheDocument();
  });

  it("清单为空（该站点没有站点侧筛选）时不渲染任何东西", async () => {
    apiMocks.getCollectFilterOptions.mockResolvedValue({ groups: [] });
    const { container } = renderFilters();
    await waitFor(() => expect(apiMocks.getCollectFilterOptions).toHaveBeenCalled());
    expect(container.querySelector(".apply-collect-site-filters")).toBeNull();
  });

  it("「测试是否生效」把当前选中项（编码数组）发给后端，并逐项展示结论", async () => {
    apiMocks.testCollectFilters.mockResolvedValue({
      applied: [
        { key: "jobType", label: JOB_TYPE, value: "实习", detail: "求职类型：实习" },
        { key: "industry", label: INDUSTRY, value: "互联网", detail: "公司行业：互联网" },
      ],
      unapplied: [],
      unlimited: [],
    });
    renderFilters();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("collectFilters.action.test")) }),
    );

    await waitFor(() =>
      expect(apiMocks.testCollectFilters).toHaveBeenCalledWith({
        jobType: ["1902"],
        industry: ["100020"],
      }),
    );
    expect(await screen.findByText(t("collectFilters.result.all"))).toBeInTheDocument();
    expect(bodyText()).toContain("求职类型：实习");
  });

  it("有选不到的项时以警告色逐项说明", async () => {
    apiMocks.testCollectFilters.mockResolvedValue({
      applied: [{ key: "jobType", label: JOB_TYPE, value: "实习", detail: "求职类型：实习" }],
      unapplied: [
        {
          key: "industry",
          label: INDUSTRY,
          value: "互联网",
          detail: "这个选项不在站点当前提供的清单里（站点可能改版，或它只对部分账号可见）",
        },
      ],
      unlimited: [],
    });
    renderFilters();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("collectFilters.action.test")) }),
    );

    expect(
      await screen.findByText(t("collectFilters.result.partial", { count: 1 })),
    ).toBeInTheDocument();
    expect(bodyText()).toContain("这个选项不在站点当前提供的清单里");
  });

  it("后端报浏览器未启动（409）时把原因弹给用户", async () => {
    apiMocks.testCollectFilters.mockRejectedValue(
      new Error("请先在投递台启动投递专用浏览器，再测试筛选条件"),
    );
    renderFilters();

    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("collectFilters.action.test")) }),
    );

    await waitFor(() =>
      expect(bodyText()).toContain("请先在投递台启动投递专用浏览器，再测试筛选条件"),
    );
  });
});
