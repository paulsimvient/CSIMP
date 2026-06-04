import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ObservedFact } from "../../intel/types";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import { buildActionPreview, type ActionPreviewResult } from "../../scene/actionPreview";
import { factToLngLat } from "../../scene/theater";
import {
  isSceneOptionSelectable,
  sceneOptionFromFactId,
  scenePickRejectMessage,
  type SceneObjectOption,
} from "./sceneObjects";
import {
  loadTaskComposerFromBar,
  resolveTaskObjectSubtitle,
  taskObjectFromOption,
  type TaskObjectRef,
  type TaskObjectRole,
} from "./taskComposerTypes";

export type TaskComposerPickMode = TaskObjectRole | null;

type TaskComposerContextValue = {
  actor: TaskObjectRef | null;
  target: TaskObjectRef | null;
  action: string;
  pickMode: TaskComposerPickMode;
  pickModeLabel: string | null;
  pickFeedback: string | null;
  searchOpen: Record<TaskObjectRole | "action", boolean>;
  preview: ActionPreviewResult | null;
  previewFactIds: string[];
  setAction: (action: string) => void;
  setActorFromOption: (option: SceneObjectOption) => void;
  setTargetFromOption: (option: SceneObjectOption) => void;
  beginPick: (role: TaskObjectRole) => string;
  beginSearch: (role: TaskObjectRole | "action") => void;
  closeSearch: (role: TaskObjectRole | "action") => void;
  clearPickMode: () => void;
  locateObject: (role: TaskObjectRole) => string | undefined;
  focusObjectCard: (role: TaskObjectRole) => string | undefined;
  loadFromBar: (bar: SyncMatrixBar) => void;
  loadTargetSeed: (target: {
    factId: string;
    entity: string;
    domain?: string;
    event?: string;
  }) => void;
  handlePassiveMapClick: (
    factId: string,
    options: SceneObjectOption[]
  ) => false | "applied" | "rejected";
  isPickingFromMap: () => boolean;
  reset: () => void;
};

const TaskComposerContext = createContext<TaskComposerContextValue | null>(null);

type ProviderProps = {
  facts: ObservedFact[];
  onFocusMapFact?: (factId: string) => void;
  onPreviewFactIdsChange?: (ids: string[]) => void;
  onActionPreviewChange?: (preview: ActionPreviewResult | null) => void;
  children: ReactNode;
};

function coordForRef(ref: TaskObjectRef | null, facts: ObservedFact[]): [number, number] | undefined {
  if (!ref?.factId) return undefined;
  const index = facts.findIndex((fact) => fact.id === ref.factId);
  if (index < 0) return undefined;
  return factToLngLat(facts[index]!, index);
}

export function TaskComposerProvider({
  facts,
  onFocusMapFact,
  onPreviewFactIdsChange,
  onActionPreviewChange,
  children,
}: ProviderProps) {
  const [actor, setActor] = useState<TaskObjectRef | null>(null);
  const [target, setTarget] = useState<TaskObjectRef | null>(null);
  const [action, setAction] = useState("");
  const [pickMode, setPickMode] = useState<TaskComposerPickMode>(null);
  const pickModeRef = useRef<TaskComposerPickMode>(null);
  const [searchOpen, setSearchOpen] = useState({
    actor: false,
    target: false,
    action: false,
  });
  const [pickFeedback, setPickFeedback] = useState<string | null>(null);

  const setActorFromOption = useCallback(
    (option: SceneObjectOption) => {
      const next = taskObjectFromOption(option);
      next.subtitle = resolveTaskObjectSubtitle(next, facts) ?? next.subtitle;
      setActor(next);
      setPickFeedback(null);
      pickModeRef.current = null;
      setPickMode(null);
      setSearchOpen((prev) => ({ ...prev, actor: false }));
      const factId = next.factId;
      if (factId) onFocusMapFact?.(factId);
    },
    [facts, onFocusMapFact]
  );

  const setTargetFromOption = useCallback(
    (option: SceneObjectOption) => {
      const next = taskObjectFromOption(option);
      next.subtitle = resolveTaskObjectSubtitle(next, facts) ?? next.subtitle;
      setTarget(next);
      setPickFeedback(null);
      pickModeRef.current = null;
      setPickMode(null);
      setSearchOpen((prev) => ({ ...prev, target: false }));
      const factId = next.factId;
      if (factId) onFocusMapFact?.(factId);
    },
    [facts, onFocusMapFact]
  );

  const beginPick = useCallback((role: TaskObjectRole) => {
    pickModeRef.current = role;
    setPickMode(role);
    setPickFeedback(null);
    setSearchOpen({ actor: false, target: false, action: false });
    return role === "actor" ? "author-actor" : "author-target";
  }, []);

  const beginSearch = useCallback((role: TaskObjectRole | "action") => {
    pickModeRef.current = null;
    setPickMode(null);
    setSearchOpen({ actor: role === "actor", target: role === "target", action: role === "action" });
  }, []);

  const closeSearch = useCallback((role: TaskObjectRole | "action") => {
    setSearchOpen((prev) => ({ ...prev, [role]: false }));
  }, []);

  const clearPickMode = useCallback(() => {
    pickModeRef.current = null;
    setPickMode(null);
  }, []);

  const isPickingFromMap = useCallback(() => pickModeRef.current !== null, []);

  const locateObject = useCallback(
    (role: TaskObjectRole) => {
      const ref = role === "actor" ? actor : target;
      if (ref?.factId) onFocusMapFact?.(ref.factId);
      return ref?.factId;
    },
    [actor, onFocusMapFact, target]
  );

  const focusObjectCard = useCallback(
    (role: TaskObjectRole) => locateObject(role),
    [locateObject]
  );

  const loadFromBar = useCallback(
    (bar: SyncMatrixBar) => {
      const loaded = loadTaskComposerFromBar(bar, facts);
      setActor(loaded.actor);
      setTarget(loaded.target);
      setAction(loaded.action);
      pickModeRef.current = null;
      setPickMode(null);
      setSearchOpen({ actor: false, target: false, action: false });
      const focusId = loaded.target?.factId ?? loaded.actor?.factId;
      if (focusId) onFocusMapFact?.(focusId);
    },
    [facts, onFocusMapFact]
  );

  const loadTargetSeed = useCallback(
    (seed: { factId: string; entity: string; domain?: string; event?: string }) => {
      const label = seed.domain
        ? `${seed.domain} · ${seed.entity}${seed.event ? ` — ${seed.event}` : ""}`
        : seed.entity;
      setTarget({
        entity: seed.entity,
        label,
        factId: seed.factId,
        domain: seed.domain,
        subtitle: seed.event ?? seed.domain ?? "Objective",
        optionId: `fact:${seed.factId}`,
      });
      setPickFeedback(null);
      onFocusMapFact?.(seed.factId);
    },
    [onFocusMapFact]
  );

  const reset = useCallback(() => {
    setActor(null);
    setTarget(null);
    setAction("");
    pickModeRef.current = null;
    setPickMode(null);
    setSearchOpen({ actor: false, target: false, action: false });
  }, []);

  const handlePassiveMapClick = useCallback(
    (
      factId: string,
      options: SceneObjectOption[]
    ): false | "applied" | "rejected" => {
      const option = sceneOptionFromFactId(factId, options, facts);
      if (!option) return false;

      const mode = pickModeRef.current;
      if (mode === "actor") {
        if (isSceneOptionSelectable(option, "controllable", ["contact", "asset"])) {
          setActorFromOption(option);
          return "applied";
        }
        setPickFeedback(
          scenePickRejectMessage(option, "controllable", ["contact", "asset"])
        );
        return "rejected";
      }
      if (mode === "target") {
        if (isSceneOptionSelectable(option, "objective", ["fact", "contact", "task"])) {
          setTargetFromOption(option);
          return "applied";
        }
        setPickFeedback(
          scenePickRejectMessage(option, "objective", ["fact", "contact", "task"])
        );
        return "rejected";
      }

      if (isSceneOptionSelectable(option, "controllable", ["contact", "asset"]) && !actor) {
        setActorFromOption(option);
        return "applied";
      }
      if (isSceneOptionSelectable(option, "objective", ["fact", "contact", "task"])) {
        setTargetFromOption(option);
        return "applied";
      }
      return false;
    },
    [actor, facts, setActorFromOption, setTargetFromOption]
  );

  const preview = useMemo(() => {
    return buildActionPreview({
      action,
      actorCoord: coordForRef(actor, facts),
      targetCoord: coordForRef(target, facts),
    });
  }, [action, actor, facts, target]);

  const previewFactIds = useMemo(() => {
    const ids: string[] = [];
    if (actor?.factId) ids.push(actor.factId);
    if (target?.factId && target.factId !== actor?.factId) ids.push(target.factId);
    return ids;
  }, [actor?.factId, target?.factId]);

  useEffect(() => {
    onPreviewFactIdsChange?.(previewFactIds);
  }, [previewFactIds, onPreviewFactIdsChange]);

  useEffect(() => {
    onActionPreviewChange?.(preview);
  }, [preview, onActionPreviewChange]);

  const pickModeLabel = useMemo(() => {
    if (pickMode === "actor") return "Select a new actor on the map";
    if (pickMode === "target") return "Select a new target on the map";
    return null;
  }, [pickMode]);

  const value = useMemo(
    () => ({
      actor,
      target,
      action,
      pickMode,
      pickModeLabel,
      pickFeedback,
      searchOpen,
      preview,
      previewFactIds,
      setAction,
      setActorFromOption,
      setTargetFromOption,
      beginPick,
      beginSearch,
      closeSearch,
      clearPickMode,
      locateObject,
      focusObjectCard,
      loadFromBar,
      loadTargetSeed,
      handlePassiveMapClick,
      isPickingFromMap,
      reset,
    }),
    [
      actor,
      target,
      action,
      pickMode,
      pickModeLabel,
      pickFeedback,
      searchOpen,
      preview,
      previewFactIds,
      setActorFromOption,
      setTargetFromOption,
      beginPick,
      beginSearch,
      closeSearch,
      clearPickMode,
      locateObject,
      focusObjectCard,
      loadFromBar,
      loadTargetSeed,
      handlePassiveMapClick,
      isPickingFromMap,
      reset,
    ]
  );

  return <TaskComposerContext.Provider value={value}>{children}</TaskComposerContext.Provider>;
}

export function useTaskComposer(): TaskComposerContextValue {
  const ctx = useContext(TaskComposerContext);
  if (!ctx) {
    throw new Error("useTaskComposer must be used within TaskComposerProvider");
  }
  return ctx;
}

export function useTaskComposerOptional(): TaskComposerContextValue | null {
  return useContext(TaskComposerContext);
}
