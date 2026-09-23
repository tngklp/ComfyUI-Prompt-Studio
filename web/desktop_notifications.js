const KEY = "prompt-studio-desktop-notifications";

export function createDesktopNotifications({ storage, document, window }) {
  const API = window.Notification;
  let enabled = false;
  try { enabled = storage.getItem(KEY) === "true"; } catch {}
  const supported = () => Boolean(API && window.isSecureContext);
  return {
    get enabled() { return enabled && supported() && API.permission === "granted"; },
    get hint() {
      if (!supported()) return "Desktop notifications are unavailable at this browser address.";
      if (API.permission === "denied") return "Notifications are blocked. Allow them in your browser site settings.";
      return "Notify when generation finishes or fails while the tab is hidden.";
    },
    async setEnabled(value) {
      enabled = false;
      if (value && supported()) {
        try {
          const permission = API.permission === "default" ? await API.requestPermission() : API.permission;
          enabled = permission === "granted";
        } catch {}
      }
      try { storage.setItem(KEY, String(enabled)); } catch {}
    },
    notify(title) {
      if (!this.enabled || document.visibilityState !== "hidden") return;
      try {
        const notification = new API("Prompt Studio", { body: title, tag: "prompt-studio-generation" });
        notification.onclick = () => { try { window.focus(); } finally { notification.close(); } };
      } catch {}
    },
  };
}
