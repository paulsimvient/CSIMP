import { useEffect } from "react";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import { useTaskComposer } from "./TaskComposerContext";

type Props = {
  resetNonce: number;
  pendingBar: SyncMatrixBar | null;
};

export function TaskComposerLifecycle({ resetNonce, pendingBar }: Props) {
  const { reset, loadFromBar } = useTaskComposer();

  useEffect(() => {
    if (resetNonce === 0) return;
    reset();
  }, [resetNonce, reset]);

  useEffect(() => {
    if (!pendingBar) return;
    loadFromBar(pendingBar);
  }, [pendingBar?.id, loadFromBar]);

  return null;
}
