import type { CartSnapshot } from "@ap-pos/shared";

export type ApPosBridge = {
  publishCart(snapshot: CartSnapshot): void;
  onCartUpdate(handler: (snapshot: CartSnapshot) => void): () => void;
};

declare global {
  interface Window {
    apPos: ApPosBridge;
  }
}

export {};
