import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TouTouProvider } from "./TouTouProvider";
import { useTouTou } from "./touTouContext";
import { TOU_TOU_SETTING_EVENT } from "./touTouTypes";

const apiMocks = vi.hoisted(() => ({ getAssistantOrbSetting: vi.fn() }));

vi.mock("../../api/settings", () => apiMocks);

function Probe() {
  const { enabled } = useTouTou();
  return <output data-testid="enabled">{String(enabled)}</output>;
}

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: true });
});

describe("TouTouProvider", () => {
  it("loads the persisted setting and reacts to settings-page updates", async () => {
    apiMocks.getAssistantOrbSetting.mockResolvedValue({ enabled: false });
    render(
      <TouTouProvider>
        <Probe />
      </TouTouProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("false"));

    window.dispatchEvent(new CustomEvent(TOU_TOU_SETTING_EVENT, { detail: { enabled: true } }));
    await waitFor(() => expect(screen.getByTestId("enabled")).toHaveTextContent("true"));
  });
});
