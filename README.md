# DynamicAdaptor Explorer

A web-based visualizer for DynamicAdaptor services. Upload service configuration files and instantly render interactive swimlane diagrams showing services, connections, and external dependencies.

Ported from the `UServiceDesigner` C# WinForms desktop application to a Node.js/Express web app using the same mxGraph engine that powers [diagrams.net](https://www.diagrams.net).

---

## Table of Contents

- [Setup](#setup)
- [Running the App](#running-the-app)
  - [Default Diagram (Server-Side Path)](#default-diagram-server-side-path)
  - [BasePaths.json Override](#basepathsjson-override)
- [User Manual](#user-manual)
  - [Opening Files](#opening-files)
  - [Reading the Diagram](#reading-the-diagram)
  - [Navigating Diagrams](#navigating-diagrams)
  - [Focus Mode](#focus-mode)
  - [Properties Panel](#properties-panel)
  - [Routing View](#routing-view)
  - [Connection Type Filters](#connection-type-filters)
  - [Working with Tabs](#working-with-tabs)
  - [Saving and Exporting](#saving-and-exporting)
  - [Sidebar](#sidebar)
- [Supported File Formats](#supported-file-formats)
- [Connection Types Reference](#connection-types-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Setup

**Prerequisites:** [Node.js](https://nodejs.org) v16 or later (npm included).

```bash
npm install
```

---

## Running the App

```bash
npm start
```

The browser opens automatically at `http://localhost:3000`. To use a different port:

```bash
PORT=8080 npm start
```

### Default Diagram (Server-Side Path)

Pass a folder path as a command-line argument to pre-load a diagram on startup without requiring a file upload:

```bash
npm start "F:\Unity\Support\MyProject\Service"
```

The server looks for `config\ServiceSettings.json` and `config\DynamicAdaptor.xml` inside that folder.

### BasePaths.json Override

If the config folder contains a `BasePaths.json` file, it overrides the default path resolution:

```
<basePath>\config\BasePaths.json
```

**Format:**

```json
{
  "Paths": {
    "ConfigPath": "F:\\Unity\\Support\\EFTS\\EFTS-V6\\Service\\Config",
    "ProjectRoot": "F:\\Unity\\Support\\EFTS\\EFTS-V6\\Service"
  }
}
```

When this file is present:
- `ProjectRoot` becomes the base path used for relative database paths in routing queries
- `ServiceSettings.json` and `DynamicAdaptor.xml` are loaded from `ConfigPath` directly (not from a `config` sub-folder)

---

## User Manual

### Opening Files

Click the **File** menu or use the buttons on the welcome screen. There are three ways to open a diagram:

#### Open Config File (.config)

For `.config` files — the standard .NET Framework application configuration format used by DynamicAdaptor services.

1. **File → Open Config File (.config)**
2. Browse or drag-and-drop the `.config` file
3. Click **Load**

#### Open JSON Settings

For newer DynamicAdaptor services using JSON-based configuration. Requires **two files**:

| File | Description |
|---|---|
| **ServiceSettings.json** | JSON config containing the `ServiceList` and `ServiceSettings` |
| **DynamicAdaptor.xml** | Companion XML with per-service connector definitions |

1. **File → Open JSON Settings**
2. Select the JSON file in the first field
3. Select `DynamicAdaptor.xml` in the second field
4. Click **Load**

The tab title is set from `ServiceSettings.ProjectPath` in the JSON file when available.

#### Open Saved Diagram (.xml)

Load a previously exported diagram.

1. **File → Open Saved Diagram (.xml)**
2. Select the `.xml` file
3. Click **Load**

---

### Reading the Diagram

The diagram renders as a grid of **swimlane containers** (max 4 per row), one per service. Each swimlane shows the service's source and destination nodes inside:

```
┌─────────────────────────────┐
│        ServiceName          │  ← Service container (colour = group)
│  ┌─────────────────────┐    │
│  │ SourceName  -tcp    │    │  ← Source node (amber)
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ DestName1   -http   │    │  ← Destination node (steel-blue)
│  └─────────────────────┘    │
└─────────────────────────────┘
```

Below the service swimlanes, **external destination containers** appear:

| Container | Colour | Contents |
|---|---|---|
| HTTP hosts | Dark red | Swimlane per hostname; endpoint paths listed inside |
| Databases | Teal cylinder | One per connection string name |
| AMQP Brokers | Mauve swimlane | Labelled `AMQ Broker - {host}`; queue names inside |
| IBM MQ Brokers | Navy swimlane | Labelled `IBMMQ Broker - {host}`; queue names inside |
| File System | Olive-green swimlane | One container; folder paths listed inside |

**Connection arrows** are colour-coded by type (see [Connection Types Reference](#connection-types-reference)).

For IBM MQ request/response adaptors, a dashed curved arrow between the request and response queue endpoints visualises the round-trip pattern inside the broker.

#### Node label format

Each node is labelled `Name -type`, for example `OrderListener -tcp` or `PaymentGateway -http`.

#### Service group colours

Services are colour-coded by `ServiceGroup` using a 7-colour dark palette. The group colour appears as the swimlane header background.

#### Collapsing containers

**Double-click** a swimlane header to collapse it to just its header bar. Double-click again to expand. The ▼/▶ icon in the header indicates current state.

---

### Navigating Diagrams

| Action | How |
|---|---|
| **Pan** | Click and drag on the diagram background |
| **Zoom in/out** | `Ctrl + Mouse Wheel` |
| **Zoom in** | `Ctrl + =` or **+** toolbar button |
| **Zoom out** | `Ctrl + -` or **−** toolbar button |
| **Reset to 100%** | `Ctrl + 0` or **1:1** toolbar button |
| **Fit to window** | **View → Fit to Window** |
| **Auto-layout** | **View → Auto Layout** — re-runs the swimlane layout algorithm |
| **Multi-select** | Click and drag a rubber-band selection box |

The current zoom level is shown in the toolbar (e.g. `75%`).

---

### Focus Mode

Click any **service container** to enter Focus Mode:

- The diagram zooms to 100% and scrolls to the selected service
- All unrelated services are dimmed; the selected service and its full transitive dependency tree remain visible
- Arrows to/from external destinations are also shown
- Click a **different service** to re-focus on that service (stays in Focus Mode)
- Click the selected service again, or click **Exit Focus** in the Properties Panel, to return to the full diagram view

Focus traversal is BFS across service-to-service connections only — external destinations (HTTP hosts, brokers, databases, file system) are endpoints, not expanded further.

---

### Properties Panel

The Properties Panel on the right updates based on what is clicked.

#### Service container

- Service name
- **Calls** — services this service connects to (click to jump)
- **Called by** — services that connect to this service (click to jump)
- **Config Databases** — database files referenced by the service's `config_db_name` attribute
- **Additional configuration sections** — any child XML elements other than `Source` and `Destination` (e.g. `runtime_log`, `parameters`, `logging`) are shown as expandable key/value trees

#### Source or destination node

- Adaptor class, address, and timeout
- All resolved adaptor parameters (key/value pairs from the config section)
- A **Copy** button next to the address for quick clipboard copy

---

### Routing View

For services loaded from the default server-side path (pre-loaded diagram), a **Routing** button appears in the focus bar when the service has routing configuration (`config_db_name`). Clicking it opens the routing flowchart in a new tab.

#### Flowchart layout

```
┌──────────────────────────────────┐
│  SourceName  ·  ReceiveMsgType   │  ← Start node (source + incoming message)
└──────────────────────────────────┘
                  │
         ┌────────┴────────┐
         │  ConditionName  │  ← Diamond (condition, if present)
         └────────┬────────┘
                  │ ──────────────→  ┌─────────────────────────────────┐
                  │                  │  TRANSACT #1                    │
                  │                  │  DestinationName                │
                  │                  │      → OutputMessageName        │
                  │                  │      ← ResponseMessageName      │
                  │                  └─────────────────────────────────┘
                  │
         ┌────────┴────────────────┐
         │  TRANSLATE #2           │
         │  DestFormatName         │
         │      → OutputMessage    │
         └─────────────────────────┘
                  │
         ┌────────┴────────────────┐
         │  REPLY #3               │
         │  ↩ SourceName · MsgName │
         └─────────────────────────┘
                  │
         ┌────────┴────────┐
         │    Complete      │  ← End node
         └──────────────────┘
```

- **Message type selector** at the top of the tab switches between all receive message types for the service
- **Conditions** appear as diamond shapes to the left of their associated action, connected by a horizontal arrow
- **Parallel actions** are marked with a `‖ PARALLEL` badge

#### Clickable elements

All underlined elements in the flowchart are clickable and show details in the Properties Panel:

| Element | Properties shown |
|---|---|
| **Source name** (Start or Reply node) | FormatName, ParserType, Trans To, Trans From, Behavior |
| **Destination name** (Transact or Translate) | FormatName, ParserType, Trans To, Trans From, Behavior |
| **Message name** (any arrow) | MessageName, MessageType, Response/Request badge, Description, **Fields table** |
| **Condition diamond** | ConditionID, Name, Expression, Description |

#### Message fields table

Clicking a message name shows a **Fields** section listing all message fields:

| Column | Description |
|---|---|
| Name | Field name |
| Variable | Variable name mapping |
| Default | Default value |
| Length Type | Field length type |
| Description | Field description |

#### Data sources

Routing data is read from SQLite databases referenced by the service's `config_db_name` attribute. Multiple database files are supported — message names, format definitions, and field lists are searched across all listed databases.

---

### Connection Type Filters

The **Connection Types** section in the sidebar contains toggle buttons for each connection type (TCP, HTTP, Database, WebSocket, Web API, AMQP, ICE, IBM MQ, File). Click a button to hide all arrows of that type; click again to show them.

Filters interact with Focus Mode — hidden types remain hidden even while focused.

---

### Working with Tabs

Each file opens as a separate tab. Multiple diagrams can be open simultaneously.

- **Switch tabs** — Click the tab name
- **Close a tab** — Click the `×` on the tab
- **Tab badge** — Shows the source type (`config`, `json`, `xml`, or `routing`)

---

### Saving and Exporting

| Action | How |
|---|---|
| **Save Diagram** | **File → Save Diagram** or `Ctrl + S` — downloads `.xml` (mxGraph format) |
| **Export SVG** | **File → Export SVG** — downloads a vector image |
| **Export PNG** | **File → Export PNG** — downloads a raster image |

Saved `.xml` files can be re-opened via **Open Saved Diagram** and are compatible with [diagrams.net](https://www.diagrams.net) (Extras → Edit Diagram).

---

### Sidebar

The sidebar (toggle with **☰**) shows:

- **Search** — Type to filter the service list; press `Enter` to scroll the diagram to a single match
- **Services** — All services grouped by `ServiceGroup`
- **Legend** — Node colour key
- **Connection Types** — Filter toggle buttons (see above)

---

## Supported File Formats

### v4+ .config (XML)

UnityServices.exe.config from V4+

Only `DynamicAdaptorService` services are shown.

### JSON Settings + DynamicAdaptor.xml

v6+ ServiceSettings.json and DynamicAdaptor.xml

---

## Connection Types Reference

### Service-to-Service

| Adaptor class | Type | Arrow |
|---|---|---|
| `Gateway.TCPAdaptor` / `Gateway.TCPClient` / `Gateway.TCPListener` | `tcp` | Muted blue-grey |
| `Gateway.WebAPIAdaptor` | `api` | Muted periwinkle |
| `Gateway.WebSocketAdaptor` | `WSO` | Muted dusty purple |
| `Gateway.ICEAdaptor` | `ICE` | Muted khaki-gold |

### External Destinations

| Adaptor class | Type | External container |
|---|---|---|
| `Gateway.HTTPAdaptor` | `http` | HTTP host swimlane (grouped by hostname) |
| `Gateway.DBNetDrv` | `db` | Database cylinder (per connection string) |
| `Gateway.AMQPClient` | `amq` | AMQ Broker swimlane (grouped by hostname); arrow direction from `mq_mode` param |
| `Gateway.MQSender` | `IBMMQ` | IBM MQ Broker swimlane; outward arrow to `request_queue` |
| `Gateway.MQAdaptor` / `Gateway.IBMMQAdaptor` / `Gateway.MQAdaptorEx` | `IBMMQ` | IBM MQ Broker; two arrows (request out, response in) + dashed curved arrow between queues |
| `Gateway.MQReceiver` / `Gateway.MQListener` | `IBMMQ` | IBM MQ Broker; inward arrow from `request_queue` |
| `Gateway.FileAdaptor` | `file` | File System swimlane; source reads `source_folder`, destination writes `destination_folder` |

### IBM MQ Adaptor Parameters

Resolved from the named config section referenced by `<params config="..."/>`:

| Parameter | Description |
|---|---|
| `connection_name` | Broker host in `host(port)` format; defaults to `localhost` if absent |
| `request_queue` | Request queue name |
| `response_queue` | Response queue name (request/response adaptors only) |

### AMQP Adaptor Parameters

| Parameter | Description |
|---|---|
| `url` | Broker URL — `amqp://[user:pass@]host:port` |
| `address` | Queue name |
| `mq_mode` | `sender` (arrow outward) or `receiver` (arrow inward) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + O` | Open Config File |
| `Ctrl + S` | Save Diagram |
| `Ctrl + =` | Zoom In |
| `Ctrl + -` | Zoom Out |
| `Ctrl + 0` | Reset Zoom to 100% |
| `Ctrl + Scroll` | Zoom in/out (in diagram) |
