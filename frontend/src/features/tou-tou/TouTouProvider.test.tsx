import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TouTouProvider } from "./TouTouProvider";
import { useTouTou } from "./touTouContext";
import { TOU_TOU_SETTING_EVENT } from "./touTouTypes";

const apiMocks = vi.hoisted(() => ({ getAssistantOrbSetting: vi.fn() }));

vi.mock("../../api/settings", () => apiMocks);

function Probe() {
  const { enabled, tipsEnabled } = useTouTou();
  return (
    <>
      <output data-testid="enabled">{String(enabled)}</output>
      <output data-testid="tips">{String(tipsEnabled)}</output>
    </>
  );
}

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: true });
});

describe("TouTouProvider", () => {
  it("loads the persisted setting and reacts to settings-page updates", async () => {
    apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: false, tips_enabled: true });
    render(
      <TouTouProvider>
        <Probe />
      </TouTouProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("false"));

    window.dispatchEvent(new CustomEvent(TOU_TOU_SETTING_EVENT, { detail: { enabled: true } }));
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
  });

  it("loads and syncs tipsEnabled independently of enabled", async () => {
    apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: false });
    render(
      <TouTouProvider>
        <Probe />
      </TouTouProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("tips")).toHaveTextContent("false"));

    window.dispatchEvent(
      new CustomEvent(TOU_TOU_SETTING_EVENT, { detail: { enabled: true, tips_enabled: true } }),
    );
    await waitFor(() => expect(screen.getByTestId("tips")).toHaveTextContent("true"));
  });

  it("keeps tipsEnabled unchanged when a legacy event carries only enabled", async () => {
    /** tips_enabled 是可选字段：旧生产方不带它时，缺省消费方不得改动现值。 */
    apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true, tips_enabled: false });
    render(
      <TouTouProvider>
        <Probe />
      </TouTouProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("tips")).toHaveTextContent("false"));

    window.dispatchEvent(new CustomEvent(TOU_TOU_SETTING_EVENT, { detail: { enabled: false } }));

    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("false"));
    expect(screen.getByTestId("tips")).toHaveTextContent("false");
  });
});
