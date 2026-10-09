import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebFormRepeatedGroup } from "../../types";
import WebFormProfileRecords from "./WebFormProfileRecords";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const EDUCATION_GROUP: WebFormRepeatedGroup = {
  key: "education",
  label: "教育经历补充",
  family: "education",
  fields: [
    { key: "education_class_rank", label: "班级排名", kind: "text", sensitive: false },
    { key: "education_special_notes", label: "特殊情况说明", kind: "longtext", sensitive: false },
  ],
  records: [],
};

describe("WebFormProfileRecords", () => {
  it("可以新增两条记录、分别填写并删除其中一条", () => {
    const onChange = vi.fn();
    function Harness() {
      const [groups, setGroups] = useState([EDUCATION_GROUP]);
      return (
        <WebFormProfileRecords
          groups={groups}
          editing
          saving={false}
          showOnlyFilled={false}
          searchTerm=""
          onChange={(nextGroups) => {
            onChange(nextGroups);
            setGroups(nextGroups);
          }}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "新增教育经历补充" }));
    const firstRank = screen.getByLabelText("教育经历补充第1条班级排名");
    fireEvent.change(firstRank, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "新增教育经历补充" }));
    fireEvent.change(screen.getByLabelText("教育经历补充第2条班级排名"), {
      target: { value: "1" },
    });

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toHaveValue("3");
    expect(screen.getByLabelText("教育经历补充第2条班级排名")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "删除教育经历补充第1条" }));
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toHaveValue("1");
    expect(screen.queryByLabelText("教育经历补充第2条班级排名")).not.toBeInTheDocument();
  });

  it("查看态只显示有值的记录字段", () => {
    render(
      <WebFormProfileRecords
        groups={[
          {
            ...EDUCATION_GROUP,
            records: [{ values: { education_class_rank: "3" } }],
          },
        ]}
        editing={false}
        saving={false}
        showOnlyFilled={false}
        searchTerm=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("特殊情况说明")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除教育经历补充第1条" })).not.toBeInTheDocument();
  });

  it("教育经历补充不再展示四个是/否字段", () => {
    render(
      <WebFormProfileRecords
        groups={[EDUCATION_GROUP]}
        editing
        saving={false}
        showOnlyFilled={false}
        searchTerm=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("是否境外教育")).not.toBeInTheDocument();
    expect(screen.queryByText("是否统招")).not.toBeInTheDocument();
    expect(screen.queryByText("是否最高学历")).not.toBeInTheDocument();
    expect(screen.queryByText("是否辅修")).not.toBeInTheDocument();
  });

  it("编辑态开「只看已填写」：没填过的记录整卡隐藏，填过的保留", () => {
    // 用户反馈开关"没生效"：它此前只过滤主表字段，重复区块照旧全量显示。
    function Harness({
      showOnlyFilled,
      searchTerm,
    }: {
      showOnlyFilled: boolean;
      searchTerm: string;
    }) {
      return (
        <WebFormProfileRecords
          groups={[
            {
              ...EDUCATION_GROUP,
              records: [
                { values: { education_class_rank: "3" } },
                { values: {} },
                { values: { education_special_notes: "在校期间拿过奖学金" } },
              ],
            },
          ]}
          editing
          saving={false}
          showOnlyFilled={showOnlyFilled}
          searchTerm={searchTerm}
          onChange={vi.fn()}
        />
      );
    }

    const view = render(<Harness showOnlyFilled={false} searchTerm="" />);
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toHaveValue("3");
    expect(screen.getByLabelText("教育经历补充第2条班级排名")).toHaveValue("");
    expect(screen.getByText("在校期间拿过奖学金")).toBeInTheDocument();

    view.rerender(<Harness showOnlyFilled searchTerm="" />);
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toHaveValue("3");
    expect(screen.queryByLabelText("教育经历补充第2条班级排名")).not.toBeInTheDocument();
    expect(screen.getByText("在校期间拿过奖学金")).toBeInTheDocument();
  });

  it("搜索按值 / 字段标签 / 组名过滤记录，无匹配时整组隐藏", () => {
    function Harness({ searchTerm }: { searchTerm: string }) {
      return (
        <WebFormProfileRecords
          groups={[
            {
              ...EDUCATION_GROUP,
              records: [
                { values: { education_class_rank: "3" } },
                { values: { education_special_notes: "拿到了国家奖学金" } },
              ],
            },
          ]}
          editing
          saving={false}
          showOnlyFilled={false}
          searchTerm={searchTerm}
          onChange={vi.fn()}
        />
      );
    }

    // 按值命中：只显示第 1 条。
    const byValue = render(<Harness searchTerm="3" />);
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toBeInTheDocument();
    expect(screen.queryByLabelText("教育经历补充第2条班级排名")).not.toBeInTheDocument();
    byValue.unmount();

    // 按字段标签命中：只有第 1 条的「班级排名」含这个词。
    const byLabel = render(<Harness searchTerm="排名" />);
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toBeInTheDocument();
    expect(screen.queryByLabelText("教育经历补充第2条班级排名")).not.toBeInTheDocument();
    byLabel.unmount();

    // 按组名命中：整组记录都显示。
    const byGroup = render(<Harness searchTerm="教育经历补充" />);
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toBeInTheDocument();
    expect(screen.getByLabelText("教育经历补充第2条班级排名")).toBeInTheDocument();
    byGroup.unmount();

    // 无匹配：整组隐藏。
    render(<Harness searchTerm="不存在的词" />);
    expect(screen.queryByLabelText(/教育经历补充第\d+条/)).not.toBeInTheDocument();
  });
});
