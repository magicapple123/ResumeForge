// SPDX-License-Identifier: Apache-2.0
/**
 * 字体样张（P1-1）：四行固定内容、三种关闭方式、两种"不能正常显示"的分支。
 *
 * 这里要钉的是 P1-1 的完成判定：**三种关闭方式**（按钮 / Esc / 遮罩）+ 文件不可用提示。
 * 后者尤其重要：`FontFace.load()` reject 时如果静默回退系统字体，用户会以为"这款字体
 * 就长这样"——那是最坏的一种谎，所以断言里要求"样张块根本不渲染，只留一句不可用"。
 *
 * jsdom 没有 CSS Font Loading，所以这里装一套假的 `FontFace` / `document.fonts`：
 * 真浏览器里跑的是同一段代码，假件只负责"立刻成功 / 立刻失败"。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import FontSampleModal from "./FontSampleModal";

class FakeFontFace {
  constructor(
    public family: string,
    public source: string,
  ) {}
  load(): Promise<FakeFontFace> {
    return Promise.resolve(this);
  }
}

const fonts = { add: vi.fn(), delete: vi.fn() };

/** 「关闭」按钮的可访问名：antd 会给两个汉字之间插一个空格（渲染成「关 闭」）。 */
const CLOSE_BUTTON = new RegExp(t("common.action.close").split("").join("\\s*"));

beforeEach(() => {
  fonts.add.mockReset();
  fonts.delete.mockReset();
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function renderModal(onClose: () => void = () => undefined) {
  return render(<FontSampleModal name="Demo-Regular.otf" displayName="Demo" onClose={onClose} />);
}

describe("FontSampleModal", () => {
  it("加载成功：四行都渲染，且四行各用自己那条字号规则", async () => {
    renderModal();
    // 弹窗是 portal 到 `body` 的，所以按 `document` 取而不是按 render 容器取。
    await vi.waitFor(() => expect(document.querySelector(".font-sample-title")).not.toBeNull());

    const block = screen.getByTestId("font-sample");
    expect(block.className).toBe("font-sample");
    // 四行的类名就是设计文档里那四条（字号写死在 CSS 里，不靠内联样式）。
    expect(document.querySelector(".font-sample-title")?.textContent).toBe(
      t("fontDownload.sampleLineTitle"),
    );
    expect(document.querySelector(".font-sample-mixed")?.textContent).toBe(
      t("fontDownload.sampleLineMixed"),
    );
    expect(document.querySelector(".font-sample-punct")?.textContent).toBe(
      t("fontDownload.sampleLinePunct"),
    );
    expect(document.querySelector(".font-sample-bold")?.textContent).toBe(
      t("fontDownload.sampleLineBold"),
    );
    // 字面挂上去了：读得到才说明真喂给了文件 URL。
    expect(fonts.add).toHaveBeenCalledTimes(1);
  });

  it("文件读不到（load reject）：只留一句不可用，不渲染样张（不回退系统字体冒充）", async () => {
    class BrokenFontFace extends FakeFontFace {
      override load(): Promise<FakeFontFace> {
        return Promise.reject(new Error("404"));
      }
    }
    vi.stubGlobal("FontFace", BrokenFontFace);

    renderModal();

    await vi.waitFor(() =>
      expect(screen.getByText(t("fontDownload.sampleUnavailable"))).toBeInTheDocument(),
    );
    // 关键：样张块**不渲染**——回退系统字体冒充这款字体是最坏的一种谎。
    expect(screen.queryByTestId("font-sample")).toBeNull();
  });

  it("三种关闭方式：关闭按钮 / Esc / 点遮罩", async () => {
    const onClose = vi.fn();
    renderModal(onClose);
    await vi.waitFor(() => expect(screen.queryByTestId("font-sample")).not.toBeNull());

    // ① 底部「关闭」（antd 会在两个汉字之间插空格，所以按正则取）
    fireEvent.click(screen.getByRole("button", { name: CLOSE_BUTTON }));
    expect(onClose).toHaveBeenCalled();

    // ② Esc（`keyboard` 缺省 true）
    onClose.mockClear();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", keyCode: 27, which: 27 });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());

    // ③ 点遮罩：只读弹窗给 `mask={{ closable: true }}`，点空白处就能关。
    onClose.mockClear();
    const wrap = document.querySelector(".ant-modal-wrap") as HTMLElement;
    fireEvent.mouseDown(wrap);
    fireEvent.mouseUp(wrap);
    fireEvent.click(wrap);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("已在用时「设为当前」不可点（说明为什么点了没反应）", async () => {
    const onActivate = vi.fn();
    render(
      <FontSampleModal
        name="Demo-Regular.otf"
        active
        onActivate={onActivate}
        onClose={() => undefined}
      />,
    );
    await Promise.resolve();

    const button = screen.getByRole("button", { name: t("fontDownload.sampleActive") });
    expect(button).toBeDisabled();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
