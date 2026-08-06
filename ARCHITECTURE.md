# ARCHITECTURE.md: The StratCraft "OS" Design

## 1. The Vision: A Decentralized Quant Ecosystem

StratCraft is not just an application; it is a **modular operating system** for quantitative trading. Our architecture is designed to solve the three biggest pain points in quant software:

* **Performance vs. Agility**: High-performance C++ core with flexible Python/TS plugins.
* **Security vs. Extensibility**: A "Core-as-Broker" model that sandboxes third-party modules.
* **AI Integration**: Native MCP (Model Context Protocol) support to let LLMs drive the entire stack.

---

## 2. High-Level System Topology

StratCraft follows a **Layered Micro-Kernel** architecture.

| Layer | Component | Tech Stack | Responsibility |
| --- | --- | --- | --- |
| **L0: Shell** | Desktop UI | Electron / React | Rendering sandboxed UIs, managing window layouts. |
| **L1: Core** | Nexus Engine | **C++20** / gRPC | Orchestration, security brokerage, high-speed data routing. |
| **L2: SDK** | Nexus Protocols | TS / Python / C++ | Standardized interfaces (Data, Execution, Auth, UI). |
| **L3: Plugin** | Third-party Modules | Any Language | Specific business logic (Backtesting, Exchanges, AI Agents). |

---

## 3. The "Core-as-Broker" Security Model

To protect users in an open-source ecosystem, StratCraft implements a **Strict Brokerage Pattern**. Plugins never interact directly with sensitive resources.

### 3.1 Sandboxed Authentication

Unlike traditional platforms that let plugins handle raw credentials, StratCraft uses a **Declarative UI + Core Proxy** flow:

1. **Declaration**: Plugins declare their auth requirements in a `manifest.json`.
2. **Rendering**: The **L0 Shell** renders a standardized, unhackable login dialog.
3. **Proxying**: The **L1 C++ Core** handles the HTTPS handshake with the plugin's server.
4. **Isolation**: Sensitive tokens are stored in the OS-level Secure Vault (Keychain/Credential Manager), accessible only via the Core.

### 3.2 Permission System

Inspired by mobile OS designs, every plugin must request explicit permissions for:

* `network`: Specific domains (e.g., `api.binance.com`).
* `filesystem`: Sandboxed paths only.
* `system`: Notifications, clipboard, or hardware keys.

---

## 4. Communication Fabric (gRPC + IPC)

We use **gRPC** as our primary "nervous system." This allows for:

* **Language Agnostic Development**: Write your backtest engine in C++ for speed, and your AI analyzer in Python for flexibility.
* **Local-First Performance**: Optimized for Unix Domain Sockets and Shared Memory to ensure sub-millisecond latency between Core and Plugins.

---

## 5. Plugin Ecosystem Management

StratCraft promotes a **decoupled lifecycle** for plugins:

* **Discovery**: Core scans the `/plugins` directory for `manifest.json`.
* **Process Isolation**: Each plugin runs in its own process. A crash in a Backtest engine will not crash your Trading Terminal.
* **Hot Reloading**: Developers can update plugin code without restarting the main StratCraft engine.

---

## 6. Developer Experience (DX)

We provide high-level SDKs to abstract the complexity of gRPC:

* **`@StratCraft/sdk-ts`**: For building UI panels and dashboard widgets.
* **`StratCraft-sdk-python`**: For strategy research and AI integration.
* **`StratCraft-sdk-cpp`**: For high-frequency data and execution providers.

---

## 7. Roadmap & Future Evolution

* **Phase 1**: C++ Core Infrastructure & gRPC Protocol stabilization.
* **Phase 2**: MCP Server integration for AI-native strategy generation.
* **Phase 3**: Distributed Backtesting (Core as a cluster coordinator).

---


???? `ARCHITECTURE.md`, ?? GitHub ???????**???????**.

?????????? **`manifest.json` ? JSON Schema ??**.????????????, ?? C++ Core ?????????????.

**?????????????????????? `manifest.json` ??????** ?????????? C++ Core ???????.