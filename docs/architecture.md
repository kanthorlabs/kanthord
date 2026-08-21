# kanthord Layered Architecture

```mermaid
flowchart TB
    subgraph L0["Layer 0 · Actors"]
        op["Operator (shell)"]
        worker["External worker / coding agent"]
    end

    subgraph L1["Layer 1 · Process"]
        bin["kanthord bin (dist/main.js)"]
        main["src/main.ts — composition root<br/>binds every dependency once"]
    end

    subgraph L2["Layer 2 · cli/ (commander)"]
        serve["kanthord serve"]
        dbmig["kanthord db migrate<br/>(the one direct-storage command)"]
        cfggen["kanthord config generate"]
        remote["project · node · plan · repository<br/>credential · actor · event · status"]
        client["DaemonClient (cli/client.ts)<br/>renders path + calls fetch"]
    end

    subgraph L3["Layer 3 · http/contract/ (transport contract, no koa)"]
        registry["operation registry<br/>typed path tuples · lifecycle<br/>zod schemas · OpenAPI emitter"]
    end

    subgraph L4["Layer 4 · http/server/ (koa)"]
        mw["middleware chain:<br/>envelope → origin → host → preflight<br/>→ auth (Bearer, timingSafeEqual)<br/>→ route → authorize → bodyParser<br/>→ idempotency (in-memory store)<br/>→ dispatch"]
        handlers["~50 operation handlers<br/>parse → invoke one command/query → format"]
        net["listen(bind:port)<br/>shutdown on SIGTERM/SIGINT"]
    end

    subgraph L5["Layer 5 · application logic (no vendor imports)"]
        cmds["commands/ — write paths<br/>provider · project · repository · plan<br/>node (claim/heartbeat/release/report…)<br/>outcome (report/close/aggregate)<br/>actor · startup-recovery"]
        qrs["queries/ — read paths<br/>system · provider · repository · project<br/>node · edge · event · blob · plan · actor"]
    end

    subgraph L6["Layer 6 · domain/ (pure, zod only)"]
        dom["entities · state machines · transitions<br/>lease hierarchy · attempt accounting<br/>plan format + canonical serialization<br/>bytewise ordering · ULID tie-break"]
    end

    subgraph L7["Layer 7 · services/ — interfaces"]
        ifaces["storage · event · lease · execution · plan · blob<br/>revision · graph · git · document · readiness<br/>ids · clock · crypto · secret · model-catalog<br/>config · home-lock · agent† · verify†"]
    end

    subgraph L8["Layer 8 · services/ — implementations"]
        sqlimpl["SqliteStorage (+ migrations 0001–0008)<br/>SqliteEventLog · SqliteLease<br/>SqliteExecution · SqlitePlanStore<br/>SqliteBlobStore"]
        gitimpl["BinaryGit<br/>runner · journal · probe · worktree<br/>ref-update · seed · sweep<br/>outside-writer guard"]
        miscimpl["GraphologyGraph · YamlDocumentReader<br/>NodeWriteRevision · DependencyReadiness<br/>UlidIdGenerator · SystemClock<br/>AesGcmCrypto · NodeCryptoSecret<br/>PiAiModelCatalog · ConvictConfig<br/>SqliteHomeLock + StatfsProbe"]
    end

    subgraph L9["Layer 9 · external resources"]
        dbfile[("home/kanthord.db<br/>one SQLite file, all state")]
        homedir[("home/<br/>git worktrees · journal · run/ · keys")]
        gitbin["git binary"]
        secfiles[("config file · master key")]
        models["model-provider APIs (pi-ai)"]
    end

    op -->|"runs kanthord …"| bin
    bin --> main
    main -->|"buildProgram"| L2
    serve -.->|"invokes serve()"| main
    dbmig -.->|"invokes migrate()"| main
    op --> remote
    remote --> client
    client -->|"renders request from"| registry
    client -->|"HTTP + Bearer token"| net
    worker -->|"claim · heartbeat · report"| net
    net --> mw
    mw -->|"route match via"| registry
    mw --> handlers
    handlers --> cmds
    handlers --> qrs
    cmds --> dom
    qrs --> dom
    cmds --> ifaces
    qrs --> ifaces
    ifaces -.->|"implemented by"| sqlimpl
    ifaces -.->|"implemented by"| gitimpl
    ifaces -.->|"implemented by"| miscimpl
    main -->|"constructs + injects"| L8
    sqlimpl --> dbfile
    gitimpl --> gitbin
    gitimpl --> homedir
    miscimpl --> secfiles
    miscimpl --> models
```

## Notes

- `†`: `services/agent` and `services/verify` declare interfaces only. Their only implementation is `not-implemented`.
- Startup order: load config → acquire home lock → probe git tools → open and migrate SQLite → bootstrap actor → construct services → recover home → bind handlers → listen.
- One transaction rule: a write command opens one `storage.transact`, and event, lease, execution, and plan stores accept that transaction through their interfaces.
- The CLI imports no command or query. It renders paths from `http/contract/` and speaks HTTP.
