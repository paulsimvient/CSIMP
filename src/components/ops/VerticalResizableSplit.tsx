import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./VerticalResizableSplit.module.css";

type Props = {
  top: ReactNode;
  bottom: ReactNode;
  defaultTopHeight?: number;
  minTop?: number;
  minBottom?: number;
  className?: string;
};

function resizeStep(event: KeyboardEvent): number {
  return event.shiftKey ? 40 : 16;
}

export function VerticalResizableSplit({
  top,
  bottom,
  defaultTopHeight = 280,
  minTop = 120,
  minBottom = 160,
  className,
}: Props) {
  const [topHeight, setTopHeight] = useState(defaultTopHeight);
  const containerRef = useRef<HTMLDivElement>(null);

  const containerHeight = () => containerRef.current?.offsetHeight ?? 800;

  const clampTop = useCallback(
    (target: number) => {
      const containerH = containerHeight();
      const maxTop = containerH - minBottom - 8;
      return Math.max(minTop, Math.min(target, maxTop));
    },
    [minTop, minBottom]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startTop = topHeight;

      const onMove = (ev: PointerEvent) => {
        const next = clampTop(startTop + (ev.clientY - startY));
        setTopHeight(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [topHeight, clampTop]
  );

  const handleSeparatorKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setTopHeight((current) => clampTop(current - resizeStep(event)));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setTopHeight((current) => clampTop(current + resizeStep(event)));
      } else if (event.key === "Home") {
        event.preventDefault();
        setTopHeight(minTop);
      } else if (event.key === "End") {
        event.preventDefault();
        setTopHeight(clampTop(containerHeight() - minBottom - 8));
      }
    },
    [clampTop, minTop, minBottom]
  );

  const maxTop = Math.max(minTop, containerHeight() - minBottom - 8);

  return (
    <div
      className={[styles.split, className ?? ""].filter(Boolean).join(" ")}
      ref={containerRef}
    >
      <div className={styles.topPane} style={{ height: topHeight, minHeight: minTop }}>
        {top}
      </div>
      <div
        className={styles.handle}
        onPointerDown={startDrag}
        onKeyDown={handleSeparatorKey}
        title="Drag or use arrow keys to resize"
        role="separator"
        aria-orientation="horizontal"
        aria-valuemin={minTop}
        aria-valuemax={maxTop}
        aria-valuenow={topHeight}
        aria-label="Resize map and matrix panels"
        tabIndex={0}
      />
      <div className={styles.bottomPane} style={{ minHeight: minBottom }}>
        {bottom}
      </div>
    </div>
  );
}
