import { useEffect, useMemo, useId, useRef } from "react";
import { useScenePick } from "./ScenePickContext";
import {
  filterSceneOptions,
  groupSceneOptions,
  type SceneObjectKind,
  type SceneObjectOption,
  type SceneSelectableRole,
} from "./sceneObjects";
import styles from "../../App.module.css";

type Props = {
  fieldId: string;
  label: string;
  value: string;
  selectedOptionId?: string;
  onPick: (option: SceneObjectOption) => void;
  kinds?: SceneObjectKind[];
  selectableRole?: SceneSelectableRole;
  placeholder?: string;
  fieldClassName?: string;
  showMapPickButton?: boolean;
};

export function SceneObjectSelect({
  fieldId,
  label,
  value,
  selectedOptionId,
  onPick,
  kinds,
  selectableRole,
  placeholder = "Select scene object…",
  fieldClassName,
  showMapPickButton = true,
}: Props) {
  const {
    activeFieldId,
    pickMessage,
    armField,
    armFieldSticky,
    disarmFieldNow,
    clearPickMessage,
    focusOptionOnMap,
    options,
    registerFieldHandler,
    unregisterFieldHandler,
  } = useScenePick();
  const filtered = filterSceneOptions(options, kinds, selectableRole);
  const grouped = useMemo(() => groupSceneOptions(filtered), [filtered]);
  const pickActive = activeFieldId === fieldId;
  const fieldClass = fieldClassName ?? styles.manualAuthorField;
  const labelId = useId();
  const selectId = useId();

  const selectValue =
    selectedOptionId ??
    filtered.find(
      (opt) => opt.entity === value || opt.event === value || opt.label === value
    )?.id ??
    "";

  const pickHint =
    selectableRole === "controllable"
      ? " — click grey unknown contacts (not red threats or green information objectives)"
      : " — click a green objective, threat, or contact on the map";

  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    registerFieldHandler(fieldId, {
      handler: (option) => onPickRef.current(option),
      kinds,
      selectableRole,
    });
    return () => unregisterFieldHandler(fieldId);
  }, [fieldId, kinds, selectableRole, registerFieldHandler, unregisterFieldHandler]);

  return (
    <div className={fieldClass}>
      <span id={labelId}>
        {label}
        {pickActive ? <em className={styles.scenePickHint}>{pickHint}</em> : null}
      </span>
      <div className={styles.scenePickRow}>
        <select
          id={selectId}
          aria-labelledby={labelId}
          className={pickActive ? styles.scenePickActive : undefined}
          value={selectValue}
          onFocus={() => armField(fieldId)}
          onChange={(event) => {
            const option = filtered.find((opt) => opt.id === event.target.value);
            if (option) {
              onPick(option);
              focusOptionOnMap(option);
              disarmFieldNow();
            }
          }}
        >
          <option value="">{placeholder}</option>
          {filtered.length === 0 ? (
            <option value="" disabled>
              No matching scene objects — run intel or use Map pick
            </option>
          ) : null}
          {grouped.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {showMapPickButton ? (
          <button
            type="button"
            className={pickActive ? styles.scenePickMapBtnActive : styles.scenePickMapBtn}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              clearPickMessage();
              armFieldSticky(fieldId);
            }}
            aria-pressed={pickActive}
          >
            {pickActive ? "Picking…" : "Map"}
          </button>
        ) : null}
        {pickActive ? (
          <button
            type="button"
            className={styles.scenePickCancelBtn}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => disarmFieldNow()}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {pickActive && pickMessage ? (
        <small className={styles.scenePickFeedback}>{pickMessage}</small>
      ) : null}
      {value && !selectValue ? (
        <small className={styles.scenePickInvalid}>
          Not a valid choice — pick from the list{value ? `: “${value}”` : ""}
        </small>
      ) : null}
    </div>
  );
}
