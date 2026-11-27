// SPDX-License-Identifier: Apache-2.0
/**
 * 配图选择的纯规则（R21）。
 *
 * 这四条是界面行为的地基："取消选择永远允许"、"到顶时拦下并回 `blocked`"、
 * "移除不碰库"、"缩略图顺序 = 挑选顺序"。放在纯函数上测，是因为它们一旦错了，
 * 表现是"第 5 张点了没反应"这种很难在界面上定位的问题。
 */
import { describe, expect, it } from "vitest";
import type { ApplyGreetingImageOption } from "../../types";
import { GREETING_IMAGE_MAX_FALLBACK } from "../../types";
import {
  greetingImageLimit,
  greetingImageSignature,
  removeGreetingImage,
  resolveGreetingImages,
  toggleGreetingImage,
} from "./greetingImageSelection";

const OPTIONS: ApplyGreetingImageOption[] = [
  { id: 1, name: "one.png", size_bytes: 100, deletable: true },
  { id: 2, name: "two.png", size_bytes: 200, deletable: false },
  { id: 3, name: "three.png", size_bytes: 300, deletable: true },
];

describe("greetingImageLimit", () => {
  it("用后端给的正整数", () => {
    expect(greetingImageLimit(6)).toBe(6);
  });

  it("缺失 / 0 / 负数回落兜底值（否则第一张就被拦）", () => {
    expect(greetingImageLimit(undefined)).toBe(GREETING_IMAGE_MAX_FALLBACK);
    expect(greetingImageLimit(0)).toBe(GREETING_IMAGE_MAX_FALLBACK);
    expect(greetingImageLimit(-3)).toBe(GREETING_IMAGE_MAX_FALLBACK);
  });
});

describe("toggleGreetingImage", () => {
  it("未选中的图追加到末尾（顺序即缩略图顺序）", () => {
    expect(toggleGreetingImage([1], 2, 4)).toEqual({
      next: [1, 2],
      blocked: false,
      removed: false,
    });
  });

  it("已选中的图再点一次就取消", () => {
    expect(toggleGreetingImage([1, 2], 1, 4)).toEqual({
      next: [2],
      blocked: false,
      removed: true,
    });
  });

  it("到上限时拦下第 5 张，并明确回 blocked（不许静默忽略）", () => {
    const result = toggleGreetingImage([1, 2, 3, 4], 5, 4);

    expect(result.blocked).toBe(true);
    expect(result.next).toEqual([1, 2, 3, 4]);
  });

  it("到上限时取消选择仍然允许", () => {
    const result = toggleGreetingImage([1, 2, 3, 4], 4, 4);

    expect(result.blocked).toBe(false);
    expect(result.removed).toBe(true);
    expect(result.next).toEqual([1, 2, 3]);
  });

  it("不改入参（值来自表单，原地改会让变化判断失效）", () => {
    const current = [1];
    toggleGreetingImage(current, 2, 4);

    expect(current).toEqual([1]);
  });
});

describe("removeGreetingImage", () => {
  it("只摘掉这个 id，其余顺序不变", () => {
    expect(removeGreetingImage([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("不在列表里的 id 不会误删别的", () => {
    expect(removeGreetingImage([1, 2], 9)).toEqual([1, 2]);
  });
});

describe("resolveGreetingImages", () => {
  it("按已选顺序还原选项，而不是按库里的排列", () => {
    expect(resolveGreetingImages([3, 1], OPTIONS).map((item) => item.id)).toEqual([3, 1]);
  });

  it("库里已不存在的 id 直接跳过（不画空槽）", () => {
    expect(resolveGreetingImages([1, 404], OPTIONS).map((item) => item.id)).toEqual([1]);
  });
});

describe("greetingImageSignature", () => {
  it("id 相同但可删性变了要算变化", () => {
    const before = greetingImageSignature([OPTIONS[0]]);
    const after = greetingImageSignature([{ ...OPTIONS[0], deletable: false }]);

    expect(before).not.toBe(after);
  });

  it("内容相同则签名相同（避免每渲染一次就重灌本地副本）", () => {
    expect(greetingImageSignature(OPTIONS)).toBe(
      greetingImageSignature(OPTIONS.map((item) => ({ ...item }))),
    );
  });
});
