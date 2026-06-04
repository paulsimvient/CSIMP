import styles from "./RestartConfirmDialog.module.css";

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function RestartConfirmDialog({ onConfirm, onCancel }: Props) {
  return (
    <div className={styles.backdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-labelledby="restart-dialog-title"
        aria-describedby="restart-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="restart-dialog-title">Restart scenario?</h2>
        <p id="restart-dialog-desc">
          This clears intel, COA selection, matrix tasks, and local session state for this
          scenario. Export a database snapshot first if you need to keep your work.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirmBtn} onClick={onConfirm}>
            Restart
          </button>
        </div>
      </div>
    </div>
  );
}
