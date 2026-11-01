/**
 * "Reduce motion": an in-app setting, remembered per device. On by default:
 * the planet sits still until touched, stars don't twinkle, clouds don't
 * drift, pins don't blink and fly-to is instant. Switching it off brings all
 * that back. Dragging and flinging the globe always work: they're the user's
 * own gestures.
 */
const KEY = 'photo-planet:reduce-motion';

/** Stored value → setting; anything unrecognised (or nothing) means the default, on. */
export function readReduceMotion(stored: string | null): boolean {
  return stored !== 'off';
}

function load(): boolean {
  try {
    return readReduceMotion(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return true; // storage blocked (private mode): default
  }
}

type Listener = (reduced: boolean) => void;
const listeners = new Set<Listener>();

export const motion = {
  reduced: load(),

  set(reduced: boolean): void {
    motion.reduced = reduced;
    try {
      localStorage.setItem(KEY, reduced ? 'on' : 'off');
    } catch {
      // just don't remember it
    }
    apply();
    for (const fn of listeners) fn(reduced);
  },

  onChange(fn: Listener): void {
    listeners.add(fn);
  },
};

/** CSS follows the same setting (stepped panel slides, blinking "...", the login shake). */
function apply() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('reduce-motion', motion.reduced);
}
apply();
