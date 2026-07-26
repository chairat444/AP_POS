import { contextBridge, ipcRenderer } from "electron";
import type { CartSnapshot } from "@ap-pos/shared";

contextBridge.exposeInMainWorld("apPos", {
  publishCart(snapshot: CartSnapshot) {
    ipcRenderer.send("cart:update", snapshot);
  },
  onCartUpdate(handler: (snapshot: CartSnapshot) => void) {
    const listener = (_: unknown, snapshot: CartSnapshot) => handler(snapshot);
    ipcRenderer.on("cart:update", listener);
    return () => ipcRenderer.removeListener("cart:update", listener);
  },
});
