// Per-device preferences (browser support differs per device, so these live in localStorage).

export const WAKE_KEY = "relay.wake";

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const getWake = () => get(WAKE_KEY) !== "0";
export const setWake = (on: boolean) => set(WAKE_KEY, on ? "1" : "0");

