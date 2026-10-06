import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyCard from "./PrivacyCard";

afterEach(() => cleanup());

describe("PrivacyCard", () => {
  it("states the local-only promise, the AI boundary and the export/delete paths", () => {
    render(<PrivacyCard />);

    // 三条核心承诺必须逐字可读：这是隐私优先产品的"条款页"，写得含糊等于没写。
    expect(screen.getByText(/保存在.*本机/)).toBeTruthy();
    expect(screen.getByText(/没有账号体系、没有埋点上报/)).toBeTruthy();
    expect(screen.getByText(/只在你主动调用时/)).toBeTruthy();
    expect(screen.getByText(/不含简历数据与密钥/)).toBeTruthy();
    expect(screen.getByText(/导出备份包/)).toBeTruthy();
    expect(screen.getByText(/彻底删除/)).toBeTruthy();
  });
});
