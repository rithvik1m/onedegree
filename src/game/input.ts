// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * One central key map. Every on-screen hint is generated from here, so a prompt can
 * never show a key that does something else. Modes: on foot, in the rover, everywhere.
 */

export type Action =
  | "forward" | "back" | "left" | "right" | "sprint" | "jump" | "use"
  | "quickScan" | "scanner" | "planner" | "orbit" | "view" | "notes" | "home" | "lamp"
  | "roverCam" | "recover";

export const KEYMAP: Record<Action, { codes: string[]; label: string; what: string; mode: "foot" | "rover" | "any" }> = {
  forward: { codes: ["KeyW", "ArrowUp"], label: "W", what: "move / drive forward", mode: "any" },
  back: { codes: ["KeyS", "ArrowDown"], label: "S", what: "move back / brake & reverse", mode: "any" },
  left: { codes: ["KeyA", "ArrowLeft"], label: "A", what: "left / steer left", mode: "any" },
  right: { codes: ["KeyD", "ArrowRight"], label: "D", what: "right / steer right", mode: "any" },
  sprint: { codes: ["ShiftLeft", "ShiftRight"], label: "Shift", what: "sprint", mode: "foot" },
  jump: { codes: ["Space"], label: "Space", what: "lunar jump", mode: "foot" },
  use: { codes: ["KeyE"], label: "E", what: "use · enter / exit rover", mode: "any" },
  quickScan: { codes: ["KeyH"], label: "H", what: "quick scan where you stand", mode: "any" },
  scanner: { codes: ["KeyM"], label: "M", what: "full field scanner", mode: "any" },
  planner: { codes: ["KeyP"], label: "P", what: "mission planner", mode: "any" },
  orbit: { codes: ["KeyO"], label: "O", what: "orbit / land", mode: "any" },
  view: { codes: ["KeyV"], label: "V", what: "first / third person", mode: "foot" },
  notes: { codes: ["KeyN"], label: "N", what: "field notes", mode: "any" },
  home: { codes: ["KeyR"], label: "R", what: "back to base", mode: "foot" },
  lamp: { codes: ["KeyL"], label: "L", what: "helmet lamp / rover lights", mode: "any" },
  roverCam: { codes: ["KeyC"], label: "C", what: "rover chase / cockpit camera", mode: "rover" },
  recover: { codes: ["KeyR"], label: "R", what: "recover rover (upright, unstuck)", mode: "rover" },
};

/** The action for a key code in the current mode (rover-only and foot-only keys never collide). */
export function actionFor(code: string, driving: boolean): Action | null {
  for (const [a, k] of Object.entries(KEYMAP) as [Action, (typeof KEYMAP)[Action]][]) {
    if (!k.codes.includes(code)) continue;
    if (k.mode === "any" || (k.mode === "rover") === driving) return a;
  }
  return null;
}

export const keyLabel = (a: Action): string => KEYMAP[a].label;

/**
 * A focused HUD button would otherwise "click" on Space/Enter and steal game keys after
 * a menu closes. Game keys always go to the game: blur the button first.
 */
export function releaseButtonFocus(e: KeyboardEvent): void {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return;
  if (a.closest("input, select, textarea")) return;
  if (a.tagName === "BUTTON" && !a.closest("dialog[open]")) {
    a.blur();
    if (e.code === "Space" || e.code === "Enter") e.preventDefault();
  }
}
