import { useEffect, useState } from 'react';

/** How long an overlay stays mounted after closing (its exit animation). */
export const EXIT_MS = 240;

/**
 * Keeps an overlay mounted while its exit animation plays.
 * Returns whether the native Modal should currently be visible.
 *
 * Opening never waits for a state update: the overlay shows in the same commit
 * as `visible`. (An earlier version opened through a state update made during
 * render; inside the tab screens' <Activity> boundaries that update was
 * dropped, so dialogs — the sign-out confirmation included — never opened.)
 * State is only used to linger for the exit animation after closing.
 */
export function usePresence(visible: boolean) {
  const [lingering, setLingering] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    setLingering(!visible);
  }

  useEffect(() => {
    if (!lingering) return;
    const id = setTimeout(() => setLingering(false), EXIT_MS);
    return () => clearTimeout(id);
  }, [lingering]);

  return visible || lingering;
}
