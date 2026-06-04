import { BACKGROUND_THEME_OPTIONS } from "../../theme/backgroundTheme";
import { useBackgroundTheme } from "../../theme/BackgroundThemeContext";
import styles from "./BackgroundThemeSwitcher.module.css";

export function BackgroundThemeSwitcher() {
  const { theme, setTheme } = useBackgroundTheme();

  return (
    <div className={styles.switcher} role="group" aria-label="Background theme">
      <span className={styles.label}>BG</span>
      {BACKGROUND_THEME_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={
            theme === option.id ? `${styles.option} ${styles.optionActive}` : styles.option
          }
          aria-pressed={theme === option.id}
          onClick={() => setTheme(option.id)}
          title={`${option.label} background`}
        >
          <span
            className={styles.swatch}
            style={{ background: option.swatch }}
            aria-hidden
          />
          {option.label}
        </button>
      ))}
    </div>
  );
}
