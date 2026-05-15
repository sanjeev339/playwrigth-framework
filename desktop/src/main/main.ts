import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { SettingsStore } from "./settingsStore";
import { McpManager } from "./mcpManager";
import { ChatAgent } from "./chatAgent";
import { runDiagnostics } from "./diagnostics";
import { listArtifacts, openArtifact } from "./artifacts";
import { logger } from "./logger";
import type { ChatRequest, SettingsUpdate, ToolCallRequest, WorkflowRequest } from "../shared/types";

let mainWindow: BrowserWindow | undefined;
let settings: SettingsStore;
let mcp: McpManager;
let chat: ChatAgent;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: "OrchestAI Desktop",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "../preload.js")
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings.getSnapshot());
  ipcMain.handle("settings:update", async (_event, update: SettingsUpdate) => {
    const snapshot = settings.update(update);
    await mcp.stopAll();
    mcp.loadConfig(snapshot.config);
    return snapshot;
  });

  ipcMain.handle("servers:start", async (_event, serverId?: string) => {
    if (serverId) return [await mcp.start(serverId)];
    return mcp.startEnabled();
  });
  ipcMain.handle("servers:stop", async (_event, serverId?: string) => {
    if (serverId) return [await mcp.stop(serverId)];
    return mcp.stopAll();
  });
  ipcMain.handle("servers:listTools", () => mcp.listTools());
  ipcMain.handle("servers:statuses", () => mcp.statuses());

  ipcMain.handle("tools:call", (_event, request: ToolCallRequest) => mcp.callTool(request));
  ipcMain.handle("workflow:fullLifecycle", async (_event, request: WorkflowRequest) => {
    const tools = await mcp.listTools();
    const workflowTool = tools.find((tool) => tool.name === "qa_workflow_full_lifecycle");
    if (!workflowTool) throw new Error("qa_workflow_full_lifecycle is not available. Start the Workflow server first.");
    return mcp.callTool({
      serverId: workflowTool.serverId,
      toolName: workflowTool.name,
      args: {
        source: request.source,
        base_url: request.baseUrl || undefined,
        output_path: request.outputPath || settings.getConfig().outputDir,
        record_count: request.recordCount,
        table_name: request.tableName,
        auto_patch: request.autoPatch
      }
    });
  });

  ipcMain.handle("chat:send", (_event, request: ChatRequest) => chat.send(request));
  ipcMain.handle("artifacts:list", () => listArtifacts(settings.getConfig().outputDir));
  ipcMain.handle("artifacts:open", (_event, filePath: string) => openArtifact(filePath, settings.getConfig().outputDir));
  ipcMain.handle("diagnostics:run", () => runDiagnostics(settings));
  ipcMain.handle("logs:list", () => logger.list());

  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("dialog:selectFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
}

app.whenReady().then(async () => {
  settings = new SettingsStore();
  mcp = new McpManager(settings);
  mcp.loadConfig(settings.getConfig());
  chat = new ChatAgent(settings, mcp);
  registerIpc();
  await createWindow();

  mcp.on("status", () => {
    mainWindow?.webContents.send("servers:statusChanged", mcp.statuses());
  });
});

app.on("window-all-closed", () => {
  void mcp?.stopAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("before-quit", () => {
  void mcp?.stopAll();
});
