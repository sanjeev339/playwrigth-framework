import type { OrchestAIApi } from "../preload";

declare global {
  interface Window {
    orchestAI: OrchestAIApi;
  }
}

export {};
