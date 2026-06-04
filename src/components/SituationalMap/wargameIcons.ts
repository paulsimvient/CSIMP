/** Built-in 16×16 circle marker used when a wargame SVG fails to load. */
export function createFallbackMarkerImage(): HTMLImageElement {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable for fallback marker");
  }
  ctx.fillStyle = "#67e8f9";
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 1;
  ctx.stroke();

  const image = new Image();
  image.src = canvas.toDataURL("image/png");
  return image;
}

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load icon: ${url}`));
    image.src = url;
  });
}

export type RegisterWargameIconResult = {
  registered: string[];
  failed: string[];
};

type RegisterWargameIconDeps = {
  loadImage?: (url: string) => Promise<HTMLImageElement>;
  createFallback?: () => HTMLImageElement;
};

/** Registers icons individually so one missing asset cannot block the rest. */
export async function registerWargameIcons(
  map: { hasImage: (id: string) => boolean; addImage: (id: string, image: HTMLImageElement, options?: { pixelRatio?: number }) => void },
  iconUrls: Record<string, string>,
  logWarning: (message: string) => void = console.warn,
  deps: RegisterWargameIconDeps = {}
): Promise<RegisterWargameIconResult> {
  const registered: string[] = [];
  const failed: string[] = [];
  const loadImage = deps.loadImage ?? loadImageElement;
  const createFallback = deps.createFallback ?? createFallbackMarkerImage;

  await Promise.all(
    Object.entries(iconUrls).map(async ([key, url]) => {
      const imageId = `wg-${key}`;
      if (map.hasImage(imageId)) {
        registered.push(imageId);
        return;
      }
      try {
        const image = await loadImage(url);
        map.addImage(imageId, image, { pixelRatio: 2 });
        registered.push(imageId);
      } catch (err) {
        failed.push(key);
        const detail = err instanceof Error ? err.message : String(err);
        logWarning(`[SituationalMap] Missing wargame icon "${key}" (${url}): ${detail}`);
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, createFallback(), { pixelRatio: 2 });
          registered.push(imageId);
        }
      }
    })
  );

  return { registered, failed };
}
