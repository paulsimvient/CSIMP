import { describe, expect, it } from "vitest";
import { WARGAME_ICON_URLS } from "./wargameIconUrls";

describe("wargameIconUrls", () => {
  it("bundles every map icon key as a non-empty URL", () => {
    expect(Object.keys(WARGAME_ICON_URLS)).toHaveLength(15);
    for (const url of Object.values(WARGAME_ICON_URLS)) {
      expect(url.length).toBeGreaterThan(0);
      expect(url).toMatch(/\.svg|data:image\/svg\+xml|\/assets\//);
    }
  });
});
