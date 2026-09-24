import { describe, it, expect } from "vitest";
import { buildQrPayload } from "./student-code";

describe("buildQrPayload", () => {
  it("embeds the student code and a namespaced prefix", () => {
    const payload = buildQrPayload("STD-ABC12345");
    expect(payload.startsWith("TECNOID:STD-ABC12345:")).toBe(true);
  });

  it("produces different payloads for the same code on repeated calls (unguessable suffix)", () => {
    const a = buildQrPayload("STD-ABC12345");
    const b = buildQrPayload("STD-ABC12345");
    expect(a).not.toBe(b);
  });
});
