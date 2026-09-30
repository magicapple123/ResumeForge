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
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("特殊情况说明")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除教育经历补充第1条" })).not.toBeInTheDocument();
  });
});
