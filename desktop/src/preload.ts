import { contextBridge, ipcRenderer } from "electron";
import type {
  ArtifactInfo,
  ArtifactLifecycleRequest,
  ChatRequest,
  ChatResponse,
  DiagnosticItem,
  LogEntry,
  ServerStatus,
  SettingsSnapshot,
  SettingsUpdate,
  ToolCallRequest,
  ToolCallResult,
  ToolInfo,
  WorkflowRequest
} from "./shared/types";

const api = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<SettingsSnapshot>,
    update: (update: SettingsUpdate) => ipcRenderer.invoke("settings:update", update) as Promise<SettingsSnapshot>
  },
  servers: {
    start: (serverId?: string) => ipcRenderer.invoke("servers:start", serverId) as Promise<ServerStatus[]>,
    stop: (serverId?: string) => ipcRenderer.invoke("servers:stop", serverId) as Promise<ServerStatus[]>,
    listTools: () => ipcRenderer.invoke("servers:listTools") as Promise<ToolInfo[]>,
    statuses: () => ipcRenderer.invoke("servers:statuses") as Promise<ServerStatus[]>,
    onStatusChanged: (callback: (statuses: ServerStatus[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, statuses: ServerStatus[]) => callback(statuses);
      ipcRenderer.on("servers:statusChanged", listener);
      return () => {
        ipcRenderer.removeListener("servers:statusChanged", listener);
      };
    }
  },
  tools: {
    call: (request: ToolCallRequest) => ipcRenderer.invoke("tools:call", request) as Promise<ToolCallResult>
  },
  workflow: {
    fullLifecycle: (request: WorkflowRequest) => ipcRenderer.invoke("workflow:fullLifecycle", request) as Promise<ToolCallResult>,
    artifactLifecycle: (request: ArtifactLifecycleRequest) => ipcRenderer.invoke("workflow:artifactLifecycle", request) as Promise<ToolCallResult>
  },
  chat: {
    send: (request: ChatRequest) => ipcRenderer.invoke("chat:send", request) as Promise<ChatResponse>
  },
  artifacts: {
    list: () => ipcRenderer.invoke("artifacts:list") as Promise<ArtifactInfo[]>,
    open: (filePath: string) => ipcRenderer.invoke("artifacts:open", filePath) as Promise<string>
  },
  diagnostics: {
    run: () => ipcRenderer.invoke("diagnostics:run") as Promise<DiagnosticItem[]>
  },
  logs: {
    list: () => ipcRenderer.invoke("logs:list") as Promise<LogEntry[]>
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory") as Promise<string | undefined>,
    selectFile: () => ipcRenderer.invoke("dialog:selectFile") as Promise<string | undefined>
  }
};

contextBridge.exposeInMainWorld("orchestAI", api);

export type OrchestAIApi = typeof api;
