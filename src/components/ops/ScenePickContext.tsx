import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ObservedFact } from "../../intel/types";
import {
  buildSceneObjectOptions,
  isSceneOptionSelectable,
  resolveOptionMapFactId,
  sceneOptionFromFactId,
  scenePickRejectMessage,
  type SceneObjectKind,
  type SceneObjectOption,
  type SceneSelectableRole,
} from "./sceneObjects";
import type { ManualSyncEntry } from "../../coa/manualSync";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import type { OverviewTrack } from "./types";

type FieldHandler = (option: SceneObjectOption) => void;

type FieldRegistration = {
  handler: FieldHandler;
  kinds?: SceneObjectKind[];
  selectableRole?: SceneSelectableRole;
};

type ScenePickContextValue = {
  options: SceneObjectOption[];
  activeFieldId: string | null;
  pickMessage: string | null;
  armField: (fieldId: string) => void;
  armFieldSticky: (fieldId: string) => void;
  disarmField: (fieldId: string) => void;
  disarmFieldNow: () => void;
  clearPickMessage: () => void;
  registerFieldHandler: (fieldId: string, registration: FieldRegistration) => void;
  unregisterFieldHandler: (fieldId: string) => void;
  applyOptionToField: (fieldId: string, option: SceneObjectOption) => void;
  focusOptionOnMap: (option: SceneObjectOption) => void;
  handleMapFactClick: (factId: string) => boolean;
};

const ScenePickContext = createContext<ScenePickContextValue | null>(null);

/** Delay blur disarm so map mousedown/click can still read the armed field. */
const DISARM_DELAY_MS = 400;

type ProviderProps = {
  facts: ObservedFact[];
  tracks: OverviewTrack[];
  matrixBars?: SyncMatrixBar[];
  manualEntries?: ManualSyncEntry[];
  knownAssets?: string[];
  onFocusMapFact?: (factId: string) => void;
  children: ReactNode;
};

export function ScenePickProvider({
  facts,
  tracks,
  matrixBars = [],
  manualEntries = [],
  knownAssets = [],
  onFocusMapFact,
  children,
}: ProviderProps) {
  const handlersRef = useRef<Map<string, FieldRegistration>>(new Map());
  const activeFieldIdRef = useRef<string | null>(null);
  const disarmTimerRef = useRef<number | null>(null);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [pickMessage, setPickMessage] = useState<string | null>(null);

  const options = useMemo(
    () =>
      buildSceneObjectOptions({
        facts,
        tracks,
        matrixBars,
        manualEntries,
        knownAssets,
      }),
    [facts, tracks, matrixBars, manualEntries, knownAssets]
  );

  const setActiveField = useCallback((fieldId: string | null) => {
    activeFieldIdRef.current = fieldId;
    setActiveFieldId(fieldId);
  }, []);

  const cancelDisarmTimer = useCallback(() => {
    if (disarmTimerRef.current !== null) {
      window.clearTimeout(disarmTimerRef.current);
      disarmTimerRef.current = null;
    }
  }, []);

  const clearPickMessage = useCallback(() => {
    setPickMessage(null);
  }, []);

  const armField = useCallback(
    (fieldId: string) => {
      cancelDisarmTimer();
      setPickMessage(null);
      setActiveField(fieldId);
    },
    [cancelDisarmTimer, setActiveField]
  );

  const disarmFieldNow = useCallback(() => {
    cancelDisarmTimer();
    setActiveField(null);
  }, [cancelDisarmTimer, setActiveField]);

  const disarmField = useCallback(
    (fieldId: string) => {
      cancelDisarmTimer();
      disarmTimerRef.current = window.setTimeout(() => {
        if (activeFieldIdRef.current === fieldId) {
          setActiveField(null);
        }
        disarmTimerRef.current = null;
      }, DISARM_DELAY_MS);
    },
    [cancelDisarmTimer, setActiveField]
  );

  /** Stays armed until a successful map pick or another field is armed (blur-safe). */
  const armFieldSticky = useCallback(
    (fieldId: string) => {
      cancelDisarmTimer();
      setPickMessage(null);
      setActiveField(fieldId);
    },
    [cancelDisarmTimer, setActiveField]
  );

  const registerFieldHandler = useCallback((fieldId: string, registration: FieldRegistration) => {
    handlersRef.current.set(fieldId, registration);
  }, []);

  const unregisterFieldHandler = useCallback((fieldId: string) => {
    handlersRef.current.delete(fieldId);
  }, []);

  const applyOptionToField = useCallback((fieldId: string, option: SceneObjectOption) => {
    handlersRef.current.get(fieldId)?.handler(option);
  }, []);

  const focusOptionOnMap = useCallback(
    (option: SceneObjectOption) => {
      const factId = resolveOptionMapFactId(option);
      if (factId) onFocusMapFact?.(factId);
    },
    [onFocusMapFact]
  );

  const handleMapFactClick = useCallback(
    (factId: string) => {
      const fieldId = activeFieldIdRef.current;
      if (!fieldId) return false;

      cancelDisarmTimer();
      const registration = handlersRef.current.get(fieldId);
      if (!registration?.handler) return false;

      const option = sceneOptionFromFactId(factId, options, facts);
      if (!option) {
        setPickMessage("No map object matched that contact.");
        return true;
      }
      if (!isSceneOptionSelectable(option, registration.selectableRole, registration.kinds)) {
        setPickMessage(
          scenePickRejectMessage(option, registration.selectableRole, registration.kinds)
        );
        return true;
      }
      applyOptionToField(fieldId, option);
      focusOptionOnMap(option);
      setPickMessage(null);
      disarmFieldNow();
      return true;
    },
    [
      applyOptionToField,
      cancelDisarmTimer,
      disarmFieldNow,
      facts,
      focusOptionOnMap,
      options,
    ]
  );

  const value = useMemo(
    () => ({
      options,
      activeFieldId,
      pickMessage,
      armField,
      armFieldSticky,
      disarmField,
      disarmFieldNow,
      clearPickMessage,
      registerFieldHandler,
      unregisterFieldHandler,
      applyOptionToField,
      focusOptionOnMap,
      handleMapFactClick,
    }),
    [
      options,
      activeFieldId,
      pickMessage,
      armField,
      armFieldSticky,
      disarmField,
      disarmFieldNow,
      clearPickMessage,
      registerFieldHandler,
      unregisterFieldHandler,
      applyOptionToField,
      focusOptionOnMap,
      handleMapFactClick,
    ]
  );

  return <ScenePickContext.Provider value={value}>{children}</ScenePickContext.Provider>;
}

export function useScenePick(): ScenePickContextValue {
  const ctx = useContext(ScenePickContext);
  if (!ctx) {
    throw new Error("useScenePick must be used within ScenePickProvider");
  }
  return ctx;
}

export function useScenePickOptional(): ScenePickContextValue | null {
  return useContext(ScenePickContext);
}
