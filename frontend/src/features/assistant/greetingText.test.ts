/** greetingForHour：分时段问候的边界与恒定 headline。 */
import { describe, expect, it } from "vitest";
import { greetingForHour } from "./greetingText";

describe("greetingForHour", () => {
  it("深夜与凌晨（23 点-次日 4 点）附带休息提醒", () => {
    expect(greetingForHour(23).care).toBeTruthy();
    expect(greetingForHour(0).care).toBeTruthy();
    expect(greetingForHour(4).care).toBeTruthy();
  });

  it("其余时段不带关怀语", () => {
    expect(greetingForHour(5).care).toBeUndefined();
    expect(greetingForHour(12).care).toBeUndefined();
    expect(greetingForHour(22).care).toBeUndefined();
  });

  it("headline 恒为投投自我介绍", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(greetingForHour(hour).headline).toBe("你好，我是投投");
    }
  });
});
