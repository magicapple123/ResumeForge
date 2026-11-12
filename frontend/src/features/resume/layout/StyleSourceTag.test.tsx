// SPDX-License-Identifier: Apache-2.0
/** 来源胶囊：四档文案与 data-source（界面用 tooltip 解释"为什么是这一档"）。 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import StyleSourceTag from "./StyleSourceTag";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("StyleSourceTag", () => {
  it.each([
    ["template", "typography.source.template"],
    ["resume", "typography.source.resume"],
    ["role", "typography.source.role"],
    ["object", "typography.source.object"],
  ] as const)("%s 档显示对应文案", (source, key) => {
    render(<StyleSourceTag source={source} />);
    const tag = screen.getByText(t(key));
    expect(tag).toHaveAttribute("data-source", source);
  });
});
