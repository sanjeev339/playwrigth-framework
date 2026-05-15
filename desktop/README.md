# OrchestAI Desktop

Desktop MCP client for OrchestAI QA orchestration servers and the local
Playwright framework generator.

## Development

```bash
cd desktop
npm install
npm run dev
```

## Runtime Setup

The app can start the existing modular Python MCP servers and the local Node
Playwright MCP server from the configured project root. Use Settings to point
the app at:

- `projectPath`: the OrchestAI repository root.
- `pythonPath`: a Python 3.10+ virtual environment executable.
- `outputDir`: where generated QA artifacts should be saved.
- API keys for the selected LLM provider.

For this Playwright framework repo, the default Playwright server is:

```text
Server ID: playwright
Display name: Playwright Generator
Command: corepack
Arguments: pnpm mcp:server
```

The chat agent can use the selected LLM provider in two ways. For predictable
generation it converts a free-form manual test case into the structured
`generate_playwright_test` tool input. When the user asks the LLM to generate
the Playwright code itself, it routes to `generate_playwright_with_llm`, which
asks the LLM to draft the framework files and then runs the stability validator.
If scenario artifacts already exist, the chat agent can route to
`list_playwright_artifact_scenarios` first, then to
`generate_playwright_from_artifacts` or `generate_playwright_with_llm` with
`scenarios_combined.csv`, `test_data.json`, and the selected scenario ID.

Recommended Python setup from the repository root:

```bash
python3.10 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## V1 Boundaries

The app uses the modular servers: Planner, Data, Workflow, Utils, and Compliance. It does not use the stale `execution_server.py` reference because that file is not present in this repository.

## Adding MCP Servers

New MCP servers can be added from the Settings screen:

1. Open Settings.
2. Click Add Server in the MCP Servers section.
3. Set:
   - Server ID: stable unique id, for example `reporting`.
   - Display name: user-facing name, for example `Reporting`.
   - Command: a Python path, `corepack`, `node`, or another stdio server command.
   - Arguments: the server arguments, such as a Python file path or `pnpm mcp:server`.
   - Environment variables: one `KEY=value` entry per line.
4. Save settings.
5. Stop and start servers.
6. Open Tool Catalog and click Discover.

The renderer only edits config. The Electron main process still owns process spawning, MCP initialize/listTools/callTool, logs, and errors.

## Agent Layer

The Chat tab is powered by LangGraph in the Electron main process:

```text
React Chat UI
  -> Electron IPC
  -> LangGraph StateGraph
  -> McpManager.callTool()
  -> Python FastMCP server
```

LangGraph does not replace MCP. MCP remains the tool transport layer. LangGraph is the orchestration layer that decides whether a chat message should be answered directly or routed through an MCP tool.

The implementation lives in:

```text
src/main/chatAgent.ts
```
