/**
 * 「基本信息」卡片该有哪几项。
 *
 * 起因是一个真实反馈："QQ 号和微信号没有在基本信息里面"。查下来它们确实不在——
 * 被放在了「网申资料」板块里的 **「网申专用资料」** 卡片里。那张卡片的定位是"只用于填表、不进简历导出"
 * （它的说明文字就是这么写的，而且那句话**是准确的**：简历生成的提示词
 * `build_profile_prompt_data` 是白名单，`wechat`/`qq` 不在其中）。
 *
 * 但微信号和 QQ 号是**普通联系方式**，和手机号、邮箱同类，放进"只用于填表"的卡片会让人
 * 以为它们不属于基本资料。所以它们归「基本信息」。
 *
 * 这个文件还钉住反面：**证件号、家庭信息那类不该跑到基本信息里**——它们的说明写着
 * "只用于填表"，混进基本资料会让那句话变成假话。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ProfileBasicSection from "./ProfileBasicSection";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSection() {
  return render(
    <AntdApp>
      <Form>
        <ProfileBasicSection
          photo=""
          editing={false}
          saving={false}
          onPhotoSelect={() => undefined}
        />
      </Form>
    </AntdApp>,
  );
}

/** 某个 label 属于哪张卡片（按卡片标题判断）。 */
function cardOwning(labelText: string): string {
  const label = Array.from(document.querySelectorAll("label")).find(
    (item) => (item.textContent ?? "").trim() === labelText,
  );
  if (!label) return "NOT FOUND";
  let node: HTMLElement | null = label;
  while (node && node !== document.body) {
    if (node.classList?.contains("ant-card")) {
      const title = node.querySelector(".ant-card-head-title");
      return title ? (title.textContent ?? "").trim() : "(基本信息卡片)";
    }
    node = node.parentElement;
  }
  return "NOT IN A CARD";
}

describe("ProfileBasicSection 的分区归属", () => {
  it("微信号与 QQ 号在「基本信息」里（和手机号、邮箱在一起）", () => {
    renderSection();

    // 基本信息那张卡片没有标题（分区标题由折叠栏承担），所以是 "(基本信息卡片)"。
    expect(cardOwning("微信号")).toBe(cardOwning("手机号"));
    expect(cardOwning("QQ 号")).toBe(cardOwning("手机号"));
    expect(cardOwning("手机号")).toBe("(基本信息卡片)");
  });

  it("证件号、家庭信息不渲染在基本信息卡片里", () => {
    renderSection();

    expect(cardOwning("证件号码")).toBe("NOT FOUND");
    expect(cardOwning("家庭信息")).toBe("NOT FOUND");
  });

  it("联系方式与手机号/邮箱同属一组，方便一起填", () => {
    renderSection();

    for (const label of ["手机号", "邮箱", "微信号", "QQ 号"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
