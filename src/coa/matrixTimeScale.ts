export const SEC_PER_MINUTE = 60;
export const SEC_PER_HOUR = 60 * SEC_PER_MINUTE;
export const SEC_PER_DAY = 24 * SEC_PER_HOUR;
export const SEC_PER_WEEK = 7 * SEC_PER_DAY;

export type MatrixTimeUnit = "minute" | "hour" | "day" | "week";

export type MatrixTickOption = {
  label: string;
  sec: number;
};

export const MATRIX_TIME_UNIT_OPTIONS: { unit: MatrixTimeUnit; label: string }[] = [
  { unit: "minute", label: "Minutes" },
  { unit: "hour", label: "Hours" },
  { unit: "day", label: "Days" },
  { unit: "week", label: "Weeks" },
];

export const MATRIX_TICK_OPTIONS: Record<MatrixTimeUnit, MatrixTickOption[]> = {
  minute: [
    { label: "1 min", sec: SEC_PER_MINUTE },
    { label: "5 min", sec: 5 * SEC_PER_MINUTE },
    { label: "15 min", sec: 15 * SEC_PER_MINUTE },
    { label: "30 min", sec: 30 * SEC_PER_MINUTE },
  ],
  hour: [
    { label: "1 hr", sec: SEC_PER_HOUR },
    { label: "2 hr", sec: 2 * SEC_PER_HOUR },
    { label: "6 hr", sec: 6 * SEC_PER_HOUR },
    { label: "12 hr", sec: 12 * SEC_PER_HOUR },
  ],
  day: [
    { label: "1 day", sec: SEC_PER_DAY },
    { label: "2 days", sec: 2 * SEC_PER_DAY },
    { label: "3 days", sec: 3 * SEC_PER_DAY },
  ],
  week: [
    { label: "1 week", sec: SEC_PER_WEEK },
    { label: "2 weeks", sec: 2 * SEC_PER_WEEK },
    { label: "4 weeks", sec: 4 * SEC_PER_WEEK },
  ],
};

export function matrixTimeUnitForInterval(tickIntervalSec: number): MatrixTimeUnit {
  if (tickIntervalSec >= SEC_PER_WEEK) return "week";
  if (tickIntervalSec >= SEC_PER_DAY) return "day";
  if (tickIntervalSec >= SEC_PER_HOUR) return "hour";
  return "minute";
}

export function defaultTickIntervalForUnit(unit: MatrixTimeUnit): number {
  return MATRIX_TICK_OPTIONS[unit][0]!.sec;
}

export function resolveDefaultTimeScale(maxEndSec: number): {
  unit: MatrixTimeUnit;
  tickIntervalSec: number;
} {
  if (maxEndSec <= 2 * SEC_PER_HOUR) {
    return { unit: "minute", tickIntervalSec: SEC_PER_MINUTE };
  }
  if (maxEndSec <= 2 * SEC_PER_DAY) {
    return { unit: "hour", tickIntervalSec: SEC_PER_HOUR };
  }
  if (maxEndSec <= 14 * SEC_PER_DAY) {
    return { unit: "day", tickIntervalSec: SEC_PER_DAY };
  }
  return { unit: "week", tickIntervalSec: SEC_PER_WEEK };
}

export function resolveDefaultTickInterval(maxEndSec: number): number {
  return resolveDefaultTimeScale(maxEndSec).tickIntervalSec;
}

export function normalizeTickIntervalForUnit(
  tickIntervalSec: number,
  unit: MatrixTimeUnit
): number {
  const options = MATRIX_TICK_OPTIONS[unit];
  const match = options.find((opt) => opt.sec === tickIntervalSec);
  if (match) return match.sec;
  const unitOfInterval = matrixTimeUnitForInterval(tickIntervalSec);
  if (unitOfInterval === unit) return tickIntervalSec;
  return defaultTickIntervalForUnit(unit);
}

/** Axis / bar window labels keyed to the active column step. */
export function formatMatrixTick(offsetSec: number, tickIntervalSec: number): string {
  const unit = matrixTimeUnitForInterval(tickIntervalSec);
  const safe = Math.max(0, offsetSec);

  switch (unit) {
    case "week": {
      const n = Math.round(safe / SEC_PER_WEEK);
      return `W+${String(n).padStart(2, "0")}`;
    }
    case "day": {
      const n = Math.round(safe / SEC_PER_DAY);
      return `D+${String(n).padStart(2, "0")}`;
    }
    case "hour": {
      const n = Math.round(safe / SEC_PER_HOUR);
      return `H+${String(n).padStart(2, "0")}`;
    }
    case "minute": {
      const n = Math.round(safe / SEC_PER_MINUTE);
      return `M+${String(n).padStart(2, "0")}`;
    }
  }
}

export function parseMatrixTickToSec(label: string): number | undefined {
  const trimmed = label.trim();
  const week = trimmed.match(/^W\+(\d{1,4})$/i);
  if (week) return Number(week[1]) * SEC_PER_WEEK;
  const day = trimmed.match(/^D\+(\d{1,4})$/i);
  if (day) return Number(day[1]) * SEC_PER_DAY;
  const hour = trimmed.match(/^H\+(\d{1,4})$/i);
  if (hour) return Number(hour[1]) * SEC_PER_HOUR;
  const minute = trimmed.match(/^M\+(\d{1,4})$/i);
  if (minute) return Number(minute[1]) * SEC_PER_MINUTE;
  return undefined;
}

/** Mission timeline labels in minutes (H+MM) for NL task text and legacy editors. */
export function formatMissionTick(offsetSec: number): string {
  const totalMinutes = Math.max(0, Math.round(offsetSec / SEC_PER_MINUTE));
  return `H+${String(totalMinutes).padStart(2, "0")}`;
}

/**
 * Parses tick labels for editors. H+ means hours when the matrix uses hour-or-larger
 * columns; otherwise H+ stays mission-minute legacy (H+15 = 15 min).
 */
export function parseMissionTickToSec(
  label: string,
  tickIntervalSec?: number
): number | undefined {
  const trimmed = label.trim();
  const week = trimmed.match(/^W\+(\d{1,4})$/i);
  if (week) return Number(week[1]) * SEC_PER_WEEK;
  const day = trimmed.match(/^D\+(\d{1,4})$/i);
  if (day) return Number(day[1]) * SEC_PER_DAY;
  const minute = trimmed.match(/^M\+(\d{1,4})$/i);
  if (minute) return Number(minute[1]) * SEC_PER_MINUTE;

  const hour = trimmed.match(/^H\+(\d{1,4})$/i);
  if (hour) {
    const n = Number(hour[1]);
    if (
      tickIntervalSec !== undefined &&
      matrixTimeUnitForInterval(tickIntervalSec) !== "minute"
    ) {
      return n * SEC_PER_HOUR;
    }
    return n * SEC_PER_MINUTE;
  }
  return undefined;
}

export type MatrixTickChoice = { label: string; valueSec: number };

/** Discrete tick labels for matrix task start/end dropdowns. */
export function buildMatrixTickOptions(
  tickIntervalSec: number,
  horizonSec: number,
  maxOptions = 48
): MatrixTickChoice[] {
  const step = Math.max(tickIntervalSec, 60);
  const safeHorizon = Math.max(step, horizonSec);
  const options: MatrixTickChoice[] = [];
  for (let sec = 0; sec <= safeHorizon && options.length < maxOptions; sec += step) {
    options.push({
      label: formatMatrixTick(sec, tickIntervalSec),
      valueSec: sec,
    });
  }
  if (options.length === 0) {
    options.push({ label: formatMatrixTick(0, tickIntervalSec), valueSec: 0 });
  }
  return options;
}

export function matrixTickInputPlaceholder(tickIntervalSec: number): string {
  const unit = matrixTimeUnitForInterval(tickIntervalSec);
  switch (unit) {
    case "week":
      return "W+01";
    case "day":
      return "D+01";
    case "hour":
      return "H+02";
    default:
      return "M+15 or H+15";
  }
}
