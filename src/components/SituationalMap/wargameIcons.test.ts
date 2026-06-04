import { describe, expect, it, vi } from "vitest";
import { registerWargameIcons } from "./wargameIcons";

describe("registerWargameIcons", () => {
  it("registers remaining icons when one asset is missing", async () => {
    const map = {
      images: new Map<string, HTMLImageElement>(),
      hasImage(id: string) {
        return this.images.has(id);
      },
      addImage(id: string, image: HTMLImageElement) {
        this.images.set(id, image);
      },
    };

    const warnings: string[] = [];
    const loadImage = vi.fn(async (url: string) => {
      if (url.includes("missing")) {
        throw new Error(`Failed to load icon: ${url}`);
      }
      return { src: url } as HTMLImageElement;
    });
    const fallback = { src: "fallback" } as HTMLImageElement;

    const result = await registerWargameIcons(
      map,
      {
        good: "https://example.test/good.svg",
        bad: "https://example.test/missing.svg",
      },
      (message) => warnings.push(message),
      { loadImage, createFallback: () => fallback }
    );

    expect(result.failed).toEqual(["bad"]);
    expect(result.registered).toContain("wg-good");
    expect(result.registered).toContain("wg-bad");
    expect(map.hasImage("wg-good")).toBe(true);
    expect(map.hasImage("wg-bad")).toBe(true);
    expect(warnings.some((line) => line.includes("missing.svg"))).toBe(true);
  });
});
