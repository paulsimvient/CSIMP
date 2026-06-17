import { useMemo } from "react";
import {
  buildMatrixTickOptions,
  formatMatrixTick,
  parseMissionTickToSec,
} from "../../coa/matrixTimeScale";
import styles from "../../App.module.css";

type Props = {
  label: string;
  value: string;
  tickIntervalSec: number;
  horizonSec: number;
  onChange: (label: string, valueSec: number | undefined) => void;
  minSec?: number;
};

export function MatrixTickSelect({
  label,
  value,
  tickIntervalSec,
  horizonSec,
  onChange,
  minSec = 0,
}: Props) {
  const options = useMemo(() => {
    const base = buildMatrixTickOptions(tickIntervalSec, horizonSec).filter(
      (opt) => opt.valueSec >= minSec
    );
    const currentSec = parseMissionTickToSec(value, tickIntervalSec);
    if (
      currentSec !== undefined &&
      !base.some((opt) => opt.valueSec === currentSec)
    ) {
      return [
        ...base,
        {
          label: value.trim() || formatMatrixTick(currentSec, tickIntervalSec),
          valueSec: currentSec,
        },
      ].sort((a, b) => a.valueSec - b.valueSec);
    }
    return base;
  }, [tickIntervalSec, horizonSec, minSec, value]);

  const selectedSec =
    parseMissionTickToSec(value, tickIntervalSec) ??
    options.find((opt) => opt.label === value)?.valueSec;

  const selectValue =
    selectedSec !== undefined && options.some((opt) => opt.valueSec === selectedSec)
      ? String(selectedSec)
      : options[0]
        ? String(options[0].valueSec)
        : "";

  return (
    <label className={styles.manualAuthorField}>
      <span>{label}</span>
      <select
        value={selectValue}
        disabled={options.length === 0}
        onChange={(e) => {
          const sec = Number(e.target.value);
          const opt = options.find((item) => item.valueSec === sec);
          onChange(
            opt?.label ?? formatMatrixTick(sec, tickIntervalSec),
            Number.isFinite(sec) ? sec : undefined
          );
        }}
      >
        {options.map((opt) => (
          <option key={opt.valueSec} value={String(opt.valueSec)}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
