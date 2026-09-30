import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth";

const eventName = "via-hr-setup-preference";

// A per-user display preference, not an organisation setting or connection change.
export function useHrSetupPreference() {
  const user = useCurrentUser();
  const key = `via_hr:dashboard-setup:v1:${user.id}:${user.activeRole}`;
  const [saved, setSaved] = useState<{ key: string; hidden: boolean }>();
  useEffect(() => {
    const read = () => {
      let hidden = false;
      try {
        hidden = localStorage.getItem(key) === "hidden";
      } catch {
        // Browsers that block storage can still hide the panel for this visit.
      }
      setSaved({ key, hidden });
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener(eventName, read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener(eventName, read);
    };
  }, [key]);
  const setHidden = (hidden: boolean) => {
    try {
      if (hidden) localStorage.setItem(key, "hidden");
      else localStorage.removeItem(key);
      window.dispatchEvent(new Event(eventName));
    } catch {
      // The in-memory preference still works if saving is unavailable.
    }
    setSaved({ key, hidden });
  };
  return { loaded: saved?.key === key, hidden: saved?.key === key && saved.hidden, setHidden };
}
