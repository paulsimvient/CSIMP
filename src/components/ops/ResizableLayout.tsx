import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import styles from "./ResizableLayout.module.css";

type Props = {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  /** initial widths in px; center gets remaining space */
  defaultLeft?: number;
  defaultRight?: number;
  minLeft?: number;
  minRight?: number;
  minCenter?: number;
  /** When true, fill parent flex box instead of viewport height */
  fillParent?: boolean;
  /** Hide the left pane until task authoring is opened */
  leftCollapsed?: boolean;
  className?: string;
};

function resizeStep(event: KeyboardEvent): number {
  return event.shiftKey ? 40 : 16;
}

export function ResizableLayout({
  left,
  center,
  right,
  defaultLeft = 280,
  defaultRight = 300,
  minLeft = 180,
  minRight = 200,
  minCenter = 320,
  fillParent = false,
  leftCollapsed = false,
  className,
}: Props) {
  const [leftW, setLeftW] = useState(defaultLeft);
  const [rightW, setRightW] = useState(defaultRight);
  const containerRef = useRef<HTMLDivElement>(null);

  const containerWidth = () => containerRef.current?.offsetWidth ?? 1200;

  const clampLeft = useCallback(
    (target: number) => {
      const containerW = containerWidth();
      return Math.max(minLeft, Math.min(target, containerW - minRight - minCenter));
    },
    [minLeft, minRight, minCenter]
  );

  const clampRight = useCallback(
    (target: number) => {
      const containerW = containerWidth();
      return Math.max(minRight, Math.min(target, containerW - minLeft - minCenter));
    },
    [minLeft, minRight, minCenter]
  );

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = leftW;
      const startRight = rightW;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const containerW = containerWidth();
        if (side === "left") {
          const next = Math.max(
            minLeft,
            Math.min(startLeft + delta, containerW - minRight - minCenter)
          );
          setLeftW(next);
        } else {
          const next = Math.max(
            minRight,
            Math.min(startRight - delta, containerW - minLeft - minCenter)
          );
          setRightW(next);
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [leftW, rightW, minLeft, minRight, minCenter]
  );

  const handleLeftSeparatorKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setLeftW((current) => clampLeft(current - resizeStep(event)));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setLeftW((current) => clampLeft(current + resizeStep(event)));
      } else if (event.key === "Home") {
        event.preventDefault();
        setLeftW(minLeft);
      } else if (event.key === "End") {
        event.preventDefault();
        setLeftW(clampLeft(containerWidth() - minRight - minCenter));
      }
    },
    [clampLeft, minLeft, minRight, minCenter]
  );

  const handleRightSeparatorKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setRightW((current) => clampRight(current + resizeStep(event)));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setRightW((current) => clampRight(current - resizeStep(event)));
      } else if (event.key === "Home") {
        event.preventDefault();
        setRightW(minRight);
      } else if (event.key === "End") {
        event.preventDefault();
        setRightW(clampRight(containerWidth() - minLeft - minCenter));
      }
    },
    [clampRight, minLeft, minRight, minCenter]
  );

  const layoutClass = [
    styles.layout,
    fillParent ? styles.layoutFillParent : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const showLeft = !leftCollapsed;

  return (
    <div className={layoutClass} ref={containerRef}>
      {showLeft ? (
        <>
          <div className={styles.pane} style={{ width: leftW, minWidth: minLeft, flexShrink: 0 }}>
            {left}
          </div>

          <div
            className={styles.handle}
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={minLeft}
            aria-valuemax={Math.max(minLeft, containerWidth() - minRight - minCenter)}
            aria-valuenow={leftW}
            aria-label="Resize task author panel"
            tabIndex={0}
            onKeyDown={handleLeftSeparatorKey}
            onPointerDown={startDrag("left")}
            title="Drag or use arrow keys to resize"
          />
        </>
      ) : null}

      <div className={styles.centerPane}>
        {center}
      </div>

      <div
        className={styles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={minRight}
        aria-valuemax={Math.max(minRight, containerWidth() - minLeft - minCenter)}
        aria-valuenow={rightW}
        aria-label="Resize right panel"
        tabIndex={0}
        onKeyDown={handleRightSeparatorKey}
        onPointerDown={startDrag("right")}
        title="Drag or use arrow keys to resize"
      />

      <div className={styles.pane} style={{ width: rightW, minWidth: minRight, flexShrink: 0 }}>
        {right}
      </div>
    </div>
  );
}
