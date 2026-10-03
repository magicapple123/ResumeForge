import { describe, expect, it } from "vitest";
import { clientDiagnosticSnapshot, recordClientDiagnostic } from "./clientDiagnostics";

describe("client diagnostics", () => {
  it("redacts profile-like keys before keeping an event", () => {
    recordClientDiagnostic("test.client", {
      control_count: 2,
      email: "person@example.com",
      value: "private value",
    });

    const events = clientDiagnosticSnapshot();
    const event = events[events.length - 1];

    expect(event?.details.control_count).toBe(2);
    expect(event?.details.email).toBe("<redacted>");
    expect(event?.details.value).toBe("<redacted>");
  });
});
