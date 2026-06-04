import { describe, expect, it } from "vitest";
import { buildActionPreview } from "./actionPreview";

describe("buildActionPreview", () => {
  const actor: [number, number] = [121.0, 24.95];
  const target: [number, number] = [121.6, 25.2];

  it("builds secure perimeter preview", () => {
    const preview = buildActionPreview({
      action: "Secure",
      actorCoord: actor,
      targetCoord: target,
    });
    expect(preview?.statusLabel).toContain("Secure perimeter");
    expect(preview?.geojson.features.some((f) => f.geometry.type === "Polygon")).toBe(true);
  });

  it("builds movement arrow preview", () => {
    const preview = buildActionPreview({
      action: "Advance",
      actorCoord: actor,
      targetCoord: target,
    });
    expect(preview?.statusLabel).toContain("Movement arrow");
    expect(preview?.geojson.features.some((f) => f.geometry.type === "LineString")).toBe(true);
  });
});
