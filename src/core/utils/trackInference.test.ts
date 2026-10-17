import { describe, expect, it } from "vitest";

import { inferTrackTitle } from "./trackInference";

describe("inferTrackTitle", () => {
  it("capitalizes each word", () => {
    expect(inferTrackTitle("alto_1-solo.mp3")).toBe("Alto 1 Solo");
  });

  it("keeps letters after an umlaut lowercase", () => {
    expect(inferTrackTitle("königin.mp3")).toBe("Königin");
    expect(inferTrackTitle("Königin.mp3")).toBe("Königin");
  });

  it("handles decomposed umlauts from macOS file names", () => {
    expect(inferTrackTitle("Königin.mp3")).toBe("Königin");
  });

  it("capitalizes words starting with an umlaut", () => {
    expect(inferTrackTitle("über alles.mp3")).toBe("Über Alles");
  });
});
