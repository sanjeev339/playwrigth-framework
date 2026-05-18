import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  FolderOpen,
  Plus,
  Play,
  RefreshCw,
  Save,
  Settings,
  Square,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import type {
  ArtifactInfo,
  ChatMessage,
  DesktopConfig,
  DiagnosticItem,
  LogEntry,
  ServerConfig,
  ServerStatus,
  SettingsSnapshot,
  ToolInfo,
} from "../shared/types";

type Tab =
  | "dashboard"
  | "chat"
  | "workflow"
  | "tools"
  | "artifacts"
  | "settings"
  | "diagnostics";

const navItems: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "chat", label: "Chat", icon: Bot },
  { id: "workflow", label: "Full Lifecycle", icon: ClipboardList },
  { id: "tools", label: "Tool Catalog", icon: Wrench },
  { id: "artifacts", label: "Artifacts", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "diagnostics", label: "Diagnostics", icon: Terminal },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [settings, setSettings] = useState<SettingsSnapshot | undefined>();
  const [statuses, setStatuses] = useState<ServerStatus[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refreshAll() {
    const [snapshot, currentStatuses, currentArtifacts, currentLogs] =
      await Promise.all([
        window.orchestAI.settings.get(),
        window.orchestAI.servers.statuses(),
        window.orchestAI.artifacts.list(),
        window.orchestAI.logs.list(),
      ]);
    setSettings(snapshot);
    setStatuses(currentStatuses);
    setArtifacts(currentArtifacts);
    setLogs(currentLogs);
  }

  useEffect(() => {
    void refreshAll();
    const unsubscribe = window.orchestAI.servers.onStatusChanged(setStatuses);
    return unsubscribe;
  }, []);

  async function startServers() {
    setBusy(true);
    setNotice("");
    try {
      setStatuses(await window.orchestAI.servers.start());
      setTools(await window.orchestAI.servers.listTools());
      setNotice("Enabled MCP servers are ready.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
      void refreshAll();
    }
  }

  async function stopServers() {
    setBusy(true);
    try {
      setStatuses(await window.orchestAI.servers.stop());
      setTools([]);
      setNotice("Servers stopped.");
    } finally {
      setBusy(false);
      void refreshAll();
    }
  }

  const readyCount = statuses.filter(
    (status) => status.health === "ready",
  ).length;
  const failedCount = statuses.filter(
    (status) => status.health === "failed",
  ).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <strong>OrchestAI</strong>
            <span>Desktop MCP</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeTab === item.id ? "nav-active" : ""}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-status">
          <span>
            {readyCount}/{statuses.length || 5} servers ready
          </span>
          {failedCount > 0 && <strong>{failedCount} failed</strong>}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.id === activeTab)?.label}</h1>
            <p>
              {settings?.config.projectPath || "Loading project settings..."}
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary"
              onClick={() => void refreshAll()}
              disabled={busy}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              className="secondary"
              onClick={() => void stopServers()}
              disabled={busy}
            >
              <Square size={16} />
              Stop
            </button>
            <button onClick={() => void startServers()} disabled={busy}>
              <Play size={16} />
              Start Servers
            </button>
          </div>
        </header>
        {notice && <div className="notice">{notice}</div>}

        {activeTab === "dashboard" && (
          <Dashboard
            statuses={statuses}
            tools={tools}
            artifacts={artifacts}
            diagnostics={diagnostics}
            runDiagnostics={async () =>
              setDiagnostics(await window.orchestAI.diagnostics.run())
            }
          />
        )}
        {activeTab === "chat" && <ChatPanel />}
        {activeTab === "workflow" && (
          <WorkflowPanel
            settings={settings?.config}
            onArtifactsChanged={async () =>
              setArtifacts(await window.orchestAI.artifacts.list())
            }
          />
        )}
        {activeTab === "tools" && (
          <ToolCatalog
            tools={tools}
            refreshTools={async () =>
              setTools(await window.orchestAI.servers.listTools())
            }
          />
        )}
        {activeTab === "artifacts" && (
          <ArtifactsPanel
            artifacts={artifacts}
            refresh={async () =>
              setArtifacts(await window.orchestAI.artifacts.list())
            }
          />
        )}
        {activeTab === "settings" && settings && (
          <SettingsPanel
            snapshot={settings}
            onSaved={(snapshot) => setSettings(snapshot)}
          />
        )}
        {activeTab === "diagnostics" && (
          <DiagnosticsPanel
            diagnostics={diagnostics}
            setDiagnostics={setDiagnostics}
            logs={logs}
            refreshLogs={async () =>
              setLogs(await window.orchestAI.logs.list())
            }
          />
        )}
      </main>
    </div>
  );
}

function Dashboard(props: {
  statuses: ServerStatus[];
  tools: ToolInfo[];
  artifacts: ArtifactInfo[];
  diagnostics: DiagnosticItem[];
  runDiagnostics: () => Promise<void>;
}) {
  const failures = props.diagnostics.filter(
    (item) => item.status === "fail",
  ).length;
  return (
    <section className="grid dashboard-grid">
      <Metric
        title="Servers Ready"
        value={`${props.statuses.filter((s) => s.health === "ready").length}/${props.statuses.length || 5}`}
        icon={Boxes}
      />
      <Metric
        title="Discovered Tools"
        value={String(props.tools.length)}
        icon={Wrench}
      />
      <Metric
        title="Artifacts"
        value={String(props.artifacts.length)}
        icon={FileText}
      />
      <Metric
        title="Diagnostics"
        value={props.diagnostics.length ? `${failures} failing` : "Not run"}
        icon={Terminal}
      />
      <div className="panel span-2">
        <div className="panel-header">
          <h2>Server Health</h2>
          <button
            className="secondary"
            onClick={() => void props.runDiagnostics()}
          >
            <Terminal size={16} />
            Run Diagnostics
          </button>
        </div>
        <div className="server-list">
          {props.statuses.map((server) => (
            <ServerRow key={server.id} server={server} />
          ))}
          {!props.statuses.length && (
            <p className="muted">No servers loaded yet.</p>
          )}
        </div>
      </div>
      <div className="panel">
        <h2>Recommended First Run</h2>
        <ol className="compact-list">
          <li>Open Settings and confirm the project path.</li>
          <li>
            Add the selected provider API key for chat-driven tool routing.
          </li>
          <li>Start servers and discover the Tool Catalog.</li>
          <li>
            Use Playwright Generator for browser automation or Full Lifecycle
            for QA artifacts.
          </li>
        </ol>
      </div>
    </section>
  );
}

function Metric({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <div className="metric">
      <Icon size={20} />
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ServerRow({ server }: { server: ServerStatus }) {
  const Icon =
    server.health === "ready"
      ? CheckCircle2
      : server.health === "failed"
        ? XCircle
        : Activity;
  return (
    <div className={`server-row ${server.health}`}>
      <Icon size={18} />
      <div>
        <strong>{server.name}</strong>
        <span>
          {server.lastError ||
            `${server.toolCount} tools${server.pid ? ` · pid ${server.pid}` : ""}`}
        </span>
      </div>
      <small>{server.health}</small>
    </div>
  );
}

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const response = await window.orchestAI.chat.send({
        message: draft,
        history: messages,
      });
      setMessages((current) => [...current, ...response.messages]);
      setDraft("");
    } catch (error) {
      setMessages((current) => [
        ...current,
        makeLocalMessage("assistant", errorMessage(error)),
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel tall">
      <div className="chat-log">
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <span>{message.role}</span>
            <pre>{message.content}</pre>
          </article>
        ))}
        {!messages.length && (
          <p className="muted">
            Ask for a test strategy, scenarios, synthetic data, a bug report, or
            a full QA lifecycle run.
          </p>
        )}
      </div>
      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Generate a full QA lifecycle for this requirement..."
        />
        <button onClick={() => void send()} disabled={busy || !draft.trim()}>
          <Bot size={16} />
          Send
        </button>
      </div>
    </section>
  );
}

function WorkflowPanel({
  settings,
  onArtifactsChanged,
}: {
  settings?: DesktopConfig;
  onArtifactsChanged: () => Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [outputPath, setOutputPath] = useState(settings?.outputDir || "");
  const [recordCount, setRecordCount] = useState(10);
  const [tableName, setTableName] = useState("test_data");
  const [autoPatch, setAutoPatch] = useState(false);
  const [result, setResult] = useState("");
  const [scenariosCsvPath, setScenariosCsvPath] = useState("");
  const [testDataJsonPath, setTestDataJsonPath] = useState("");
  const [artifactBaseUrl, setArtifactBaseUrl] = useState("");
  const [artifactOutputDir, setArtifactOutputDir] = useState(settings?.outputDir || "");
  const [artifactEnv, setArtifactEnv] = useState("dev");
  const [artifactHeaded, setArtifactHeaded] = useState(true);
  const [artifactSuitability, setArtifactSuitability] = useState<"Yes" | "No" | "Partial" | "All">("Yes");
  const [maxRepairAttempts, setMaxRepairAttempts] = useState(2);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [artifactResult, setArtifactResult] = useState("");
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOutputPath(settings?.outputDir || "");
    setArtifactOutputDir(settings?.outputDir || "");
  }, [settings?.outputDir]);

  async function run() {
    setBusy(true);
    setResult("");
    try {
      const response = await window.orchestAI.workflow.fullLifecycle({
        source,
        baseUrl,
        outputPath,
        recordCount,
        tableName,
        autoPatch,
      });
      setResult(response.content);
      await onArtifactsChanged();
    } catch (error) {
      setResult(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile() {
    const file = await window.orchestAI.dialog.selectFile();
    if (file) setSource(file);
  }

  async function chooseOutput() {
    const directory = await window.orchestAI.dialog.selectDirectory();
    if (directory) setOutputPath(directory);
  }

  async function chooseArtifactFile(field: "csv" | "json") {
    const file = await window.orchestAI.dialog.selectFile();
    if (!file) return;
    if (field === "csv") {
      setScenariosCsvPath(file);
    } else {
      setTestDataJsonPath(file);
    }
  }

  async function chooseArtifactOutput() {
    const directory = await window.orchestAI.dialog.selectDirectory();
    if (directory) setArtifactOutputDir(directory);
  }

  async function runArtifactLifecycle() {
    setArtifactBusy(true);
    setArtifactResult("");
    try {
      const response = await window.orchestAI.workflow.artifactLifecycle({
        scenariosCsvPath,
        testDataJsonPath,
        baseUrl: artifactBaseUrl,
        outputDir: artifactOutputDir,
        env: artifactEnv,
        headed: artifactHeaded,
        automationSuitability: artifactSuitability,
        maxRepairAttempts,
        stopOnFailure,
      });
      setArtifactResult(response.content);
      await onArtifactsChanged();
    } catch (error) {
      setArtifactResult(errorMessage(error));
    } finally {
      setArtifactBusy(false);
    }
  }

  return (
    <section className="split">
      <div className="panel">
        <h2>Run Artifact Lifecycle</h2>
        <label>Scenarios CSV</label>
        <div className="input-row">
          <input
            value={scenariosCsvPath}
            onChange={(event) => setScenariosCsvPath(event.target.value)}
            placeholder="/path/to/scenarios_combined.csv"
          />
          <button
            className="secondary icon-only"
            onClick={() => void chooseArtifactFile("csv")}
            aria-label="Choose scenarios CSV"
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <label>Test data JSON</label>
        <div className="input-row">
          <input
            value={testDataJsonPath}
            onChange={(event) => setTestDataJsonPath(event.target.value)}
            placeholder="/path/to/test_data.json"
          />
          <button
            className="secondary icon-only"
            onClick={() => void chooseArtifactFile("json")}
            aria-label="Choose test data JSON"
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <label>Base URL</label>
        <input
          value={artifactBaseUrl}
          onChange={(event) => setArtifactBaseUrl(event.target.value)}
          placeholder="https://adminportal.dev.eigen-dyne.com/login/"
        />
        <label>Output directory</label>
        <div className="input-row">
          <input
            value={artifactOutputDir}
            onChange={(event) => setArtifactOutputDir(event.target.value)}
          />
          <button
            className="secondary icon-only"
            onClick={() => void chooseArtifactOutput()}
            aria-label="Choose lifecycle output directory"
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <div className="two-col">
          <div>
            <label>Environment</label>
            <input
              value={artifactEnv}
              onChange={(event) => setArtifactEnv(event.target.value)}
            />
          </div>
          <div>
            <label>Suitability</label>
            <select
              value={artifactSuitability}
              onChange={(event) =>
                setArtifactSuitability(event.target.value as "Yes" | "No" | "Partial" | "All")
              }
            >
              <option value="Yes">Yes</option>
              <option value="All">All</option>
              <option value="Partial">Partial</option>
              <option value="No">No</option>
            </select>
          </div>
        </div>
        <div className="two-col">
          <div>
            <label>Repair attempts</label>
            <input
              type="number"
              min={0}
              max={5}
              value={maxRepairAttempts}
              onChange={(event) => setMaxRepairAttempts(Number(event.target.value))}
            />
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={artifactHeaded}
              onChange={(event) => setArtifactHeaded(event.target.checked)}
            />
            Show browser
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={stopOnFailure}
            onChange={(event) => setStopOnFailure(event.target.checked)}
          />
          Stop on first failed or blocked case
        </label>
        <button
          onClick={() => void runArtifactLifecycle()}
          disabled={artifactBusy || !scenariosCsvPath.trim() || !testDataJsonPath.trim()}
        >
          <Play size={16} />
          Run Uploaded Cases
        </button>
        <hr />
        <h2>Run QA Lifecycle</h2>
        <label>Requirements text, file path, or Figma URL</label>
        <textarea
          className="source-input"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <div className="row-actions">
          <button className="secondary" onClick={() => void chooseFile()}>
            <FolderOpen size={16} />
            Use File
          </button>
        </div>
        <label>Base URL</label>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://app.example.com"
        />
        <label>Output directory</label>
        <div className="input-row">
          <input
            value={outputPath}
            onChange={(event) => setOutputPath(event.target.value)}
          />
          <button
            className="secondary icon-only"
            onClick={() => void chooseOutput()}
            aria-label="Choose output directory"
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <div className="two-col">
          <div>
            <label>Record count</label>
            <input
              type="number"
              min={1}
              max={100}
              value={recordCount}
              onChange={(event) => setRecordCount(Number(event.target.value))}
            />
          </div>
          <div>
            <label>Table name</label>
            <input
              value={tableName}
              onChange={(event) => setTableName(event.target.value)}
            />
          </div>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoPatch}
            onChange={(event) => setAutoPatch(event.target.checked)}
          />
          Auto-patch rejected scenario suites
        </label>
        <button onClick={() => void run()} disabled={busy || !source.trim()}>
          <Play size={16} />
          Run Lifecycle
        </button>
      </div>
      <div className="stacked-results">
        <ResultPanel title="Artifact Lifecycle Result" result={artifactResult} />
        <ResultPanel title="QA Lifecycle Result" result={result} />
      </div>
    </section>
  );
}

function ToolCatalog({
  tools,
  refreshTools,
}: {
  tools: ToolInfo[];
  refreshTools: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<ToolInfo | undefined>();
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState("");
  const grouped = useMemo(() => groupToolsByServer(tools), [tools]);

  async function callTool() {
    if (!selected) return;
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      const response = await window.orchestAI.tools.call({
        serverId: selected.serverId,
        toolName: selected.name,
        args: parsed,
      });
      setResult(response.content);
    } catch (error) {
      setResult(errorMessage(error));
    }
  }

  return (
    <section className="split">
      <div className="panel tall scroll">
        <div className="panel-header">
          <h2>Tools</h2>
          <button className="secondary" onClick={() => void refreshTools()}>
            <RefreshCw size={16} />
            Discover
          </button>
        </div>
        {[...grouped.entries()].map(([server, serverTools]) => (
          <div key={server} className="tool-group">
            <h3>{server}</h3>
            {serverTools.map((tool) => (
              <button
                key={`${tool.serverId}-${tool.name}`}
                className={`tool-item ${selected?.name === tool.name && selected?.serverId === tool.serverId ? "selected" : ""}`}
                onClick={() => {
                  setSelected(tool);
                  setArgs("{}");
                }}
              >
                <strong>{tool.name}</strong>
                <span>{tool.description || "No description"}</span>
              </button>
            ))}
          </div>
        ))}
        {!tools.length && (
          <p className="muted">
            Start servers and click Discover to list tools.
          </p>
        )}
      </div>
      <div className="panel tall">
        <h2>{selected?.name || "Select a Tool"}</h2>
        {selected && (
          <pre className="schema">
            {JSON.stringify(selected.inputSchema, null, 2)}
          </pre>
        )}
        <label>Arguments JSON</label>
        <textarea
          className="json-input"
          value={args}
          onChange={(event) => setArgs(event.target.value)}
        />
        <button onClick={() => void callTool()} disabled={!selected}>
          <Database size={16} />
          Call Tool
        </button>
        <ResultPanel title="Tool Result" result={result} compact />
      </div>
    </section>
  );
}

function ArtifactsPanel({
  artifacts,
  refresh,
}: {
  artifacts: ArtifactInfo[];
  refresh: () => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Generated Artifacts</h2>
        <button className="secondary" onClick={() => void refresh()}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      {!artifacts.length ? (
        <p className="muted">
          No artifacts found in the configured output directory.
        </p>
      ) : (
        <div className="artifact-table">
          {artifacts.map((artifact) => (
            <button
              key={artifact.path}
              onClick={() =>
                void window.orchestAI.artifacts.open(artifact.path)
              }
            >
              <FileText size={16} />
              <span>{artifact.name}</span>
              <small>
                {formatBytes(artifact.sizeBytes)} ·{" "}
                {new Date(artifact.modifiedAt).toLocaleString()}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsPanel({
  snapshot,
  onSaved,
}: {
  snapshot: SettingsSnapshot;
  onSaved: (snapshot: SettingsSnapshot) => void;
}) {
  const [config, setConfig] = useState(snapshot.config);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");

  useEffect(() => {
    setConfig(snapshot.config);
  }, [snapshot]);

  async function selectDirectory(field: "projectPath" | "outputDir") {
    const value = await window.orchestAI.dialog.selectDirectory();
    if (value) setConfig((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    const next = await window.orchestAI.settings.update({ config, apiKeys });
    setApiKeys({});
    onSaved(next);
    setSaved("Settings saved. Restart affected servers to apply changes.");
  }

  function updateServer(serverId: string, patch: Partial<ServerConfig>) {
    setConfig((current) => ({
      ...current,
      servers: current.servers.map((server) =>
        server.id === serverId ? { ...server, ...patch } : server,
      ),
    }));
  }

  function updateServerArgs(serverId: string, value: string) {
    updateServer(serverId, { args: splitArgs(value) });
  }

  function updateServerEnv(serverId: string, value: string) {
    updateServer(serverId, { env: parseEnvLines(value) });
  }

  function addServer() {
    const index = config.servers.length + 1;
    const id = uniqueServerId(config.servers, `custom-${index}`);
    setConfig((current) => ({
      ...current,
      servers: [
        ...current.servers,
        {
          id,
          name: `Custom Server ${index}`,
          command: current.pythonPath,
          args: [""],
          env: {
            LLM_PROVIDER: current.llmProvider,
          },
          enabled: true,
        },
      ],
    }));
  }

  function removeServer(serverId: string) {
    setConfig((current) => ({
      ...current,
      servers: current.servers.filter((server) => server.id !== serverId),
    }));
  }

  return (
    <section className="panel settings-panel">
      <h2>Runtime Settings</h2>
      <label>Project path</label>
      <div className="input-row">
        <input
          value={config.projectPath}
          onChange={(event) =>
            setConfig({ ...config, projectPath: event.target.value })
          }
        />
        <button
          className="secondary icon-only"
          onClick={() => void selectDirectory("projectPath")}
          aria-label="Choose project path"
        >
          <FolderOpen size={16} />
        </button>
      </div>
      <label>Python path</label>
      <input
        value={config.pythonPath}
        onChange={(event) =>
          setConfig({ ...config, pythonPath: event.target.value })
        }
      />
      <label>Output directory</label>
      <div className="input-row">
        <input
          value={config.outputDir}
          onChange={(event) =>
            setConfig({ ...config, outputDir: event.target.value })
          }
        />
        <button
          className="secondary icon-only"
          onClick={() => void selectDirectory("outputDir")}
          aria-label="Choose output directory"
        >
          <FolderOpen size={16} />
        </button>
      </div>
      <label>LLM provider</label>
      <select
        value={config.llmProvider}
        onChange={(event) =>
          setConfig({
            ...config,
            llmProvider: event.target.value as DesktopConfig["llmProvider"],
          })
        }
      >
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <div className="two-col">
        {(["gemini", "openai", "anthropic", "figma"] as const).map((key) => (
          <div key={key}>
            <label>
              {key} API key{" "}
              {snapshot.maskedApiKeys[key] && (
                <span className="muted">({snapshot.maskedApiKeys[key]})</span>
              )}
            </label>
            <input
              type="password"
              value={apiKeys[key] || ""}
              onChange={(event) =>
                setApiKeys((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              placeholder="Leave blank to keep existing"
            />
          </div>
        ))}
      </div>
      <div className="panel-header server-settings-header">
        <div>
          <h3>MCP Servers</h3>
          <p className="muted">
            Add Python, Node, or other stdio MCP servers here, save settings,
            then restart servers.
          </p>
        </div>
        <button className="secondary" onClick={addServer}>
          <Plus size={16} />
          Add Server
        </button>
      </div>
      <div className="server-settings-list">
        {config.servers.map((server) => (
          <div key={server.id} className="server-settings-card">
            <div className="server-card-title">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(event) =>
                    updateServer(server.id, { enabled: event.target.checked })
                  }
                />
                Enabled
              </label>
              <button
                className="secondary icon-only"
                onClick={() => removeServer(server.id)}
                aria-label={`Remove ${server.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="two-col">
              <div>
                <label>Server ID</label>
                <input
                  value={server.id}
                  onChange={(event) =>
                    updateServer(server.id, { id: event.target.value.trim() })
                  }
                />
              </div>
              <div>
                <label>Display name</label>
                <input
                  value={server.name}
                  onChange={(event) =>
                    updateServer(server.id, { name: event.target.value })
                  }
                />
              </div>
            </div>
            <label>Command</label>
            <input
              value={server.command}
              onChange={(event) =>
                updateServer(server.id, { command: event.target.value })
              }
              placeholder={config.pythonPath}
            />
            <label>Arguments</label>
            <input
              value={server.args.join(" ")}
              onChange={(event) =>
                updateServerArgs(server.id, event.target.value)
              }
              placeholder="/Users/pi-in-185/OrchestAI/qa_orchestrator/my_server.py"
            />
            <label>Environment variables</label>
            <textarea
              className="env-input"
              value={formatEnvLines(server.env)}
              onChange={(event) =>
                updateServerEnv(server.id, event.target.value)
              }
              placeholder="LLM_PROVIDER=gemini"
            />
          </div>
        ))}
      </div>
      <button onClick={() => void save()}>
        <Save size={16} />
        Save Settings
      </button>
      {saved && <div className="notice">{saved}</div>}
    </section>
  );
}

function DiagnosticsPanel({
  diagnostics,
  setDiagnostics,
  logs,
  refreshLogs,
}: {
  diagnostics: DiagnosticItem[];
  setDiagnostics: (items: DiagnosticItem[]) => void;
  logs: LogEntry[];
  refreshLogs: () => Promise<void>;
}) {
  async function run() {
    setDiagnostics(await window.orchestAI.diagnostics.run());
    await refreshLogs();
  }
  return (
    <section className="split">
      <div className="panel tall scroll">
        <div className="panel-header">
          <h2>Diagnostics</h2>
          <button onClick={() => void run()}>
            <Terminal size={16} />
            Run
          </button>
        </div>
        {diagnostics.map((item) => (
          <div key={item.id} className={`diagnostic ${item.status}`}>
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
            {item.remediation && <code>{item.remediation}</code>}
          </div>
        ))}
        {!diagnostics.length && (
          <p className="muted">
            Run diagnostics to verify Python, dependencies, server files, and
            API keys.
          </p>
        )}
      </div>
      <div className="panel tall scroll">
        <div className="panel-header">
          <h2>Logs</h2>
          <button className="secondary" onClick={() => void refreshLogs()}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        {logs.map((log) => (
          <div key={log.id} className={`log ${log.level}`}>
            <span>
              {new Date(log.createdAt).toLocaleTimeString()} · {log.source}
            </span>
            <pre>{log.message}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultPanel({
  title,
  result,
  compact = false,
}: {
  title: string;
  result: string;
  compact?: boolean;
}) {
  return (
    <div className={`panel result-panel ${compact ? "compact" : ""}`}>
      <h2>{title}</h2>
      <pre>{result || "Results will appear here."}</pre>
    </div>
  );
}

function makeLocalMessage(
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function groupToolsByServer(tools: ToolInfo[]): Map<string, ToolInfo[]> {
  const grouped = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const group = grouped.get(tool.serverName) || [];
    group.push(tool);
    grouped.set(tool.serverName, group);
  }
  return grouped;
}

function splitArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatEnvLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseEnvLines(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
  return env;
}

function uniqueServerId(servers: ServerConfig[], base: string): string {
  const used = new Set(servers.map((server) => server.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
