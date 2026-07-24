# kanthord

> Kanthor's agentic program does the work with an opinionated setup. The D mean daemon, same meaning in systemd :D
> We need to build a reliable system from unreliable components. - Chapter 8, Designing Data-Intensive Applications, Martin Kleppmann.

kanthord is a long-running daemon that executes software-engineering work **across multiple repositories** on behalf of one engineer, reducing the human's workload to only the work that requires a human. Single-repo agentic coding is a commodity; kanthord's reason to exist is the **cross-repo feature orchestration layer**.

## Architecture

### Graph

Project
├── Resource
│ ├── Repository
│ ├── Credential
│ ├── Notification
│ ├── AIProvider
│ └── Filesystem
│
├── Agent
│ ├── SoftwareEngineer
│ ├── ReviewerEngineer
│ └── TestEngineer
│
└── Initiative
└── Objective
└── Task
├── Dependencies (other Task)
├── Context (Project Resource Binding)
├── Executor (Generic, TDD, PR)
└── Event

### Example

Project
├── Resource
│ ├── Repository
│ │ ├── backend
│ │ └── web
│ │
│ ├── Credential
│ │ ├── github
│ │ ├── kubernetes
│ │ └── cloudflare
│ │
│ ├── Notification
│ │ └── slack
│ │
│ ├── AIProvider
│ │ └── openai
│ │
│ └── Filesystem
│
├── Executor
│ ├── generic@1
│ ├── tdd@1
│ ├── pr@1
│ └── k8s@1
│
├── Agent
│ ├── TestEngineer
│ ├── SoftwareEngineer
│ └── ReviewerEngineer
│
└── Initiative
└── OAuth Integration
├── Objective
│ └── Backend
│ ├── Task
│ │ ├── Title
│ │ │ └── Implement Google OAuth API
│ │ ├── Executor
│ │ │ └── tdd@1
│ │ ├── Context
│ │ │ ├── Repository → backend
│ │ │ ├── Credential → github
│ │ │ └── AIProvider → openai
│ │ └── Event
│ │
│ ├── Task
│ │ ├── Title
│ │ │ └── PR Approval
│ │ ├── Executor
│ │ │ └── pr@1
│ │ ├── Dependency
│ │ │ └── Implement Google OAuth API
│ │ ├── Context
│ │ │ ├── Notification → slack
│ │ │ ├── Repository → backend
│ │ │ ├── Credential → github
│ │ │ └── AIProvider → openai
│ │ └── Event
│ │
│ └── Task
│ ├── Title
│ │ └── Deploy to Kubernetes
│ ├── Executor
│ │ └── k8s@1
│ ├── Dependency
│ │ ├── Notification → slack
│ │ └── Backend: PR Approval
│ ├── Context
│ │ └── Credential → kubernetes
│ └── Event
│
├── Objective
│ └── Web
│ ├── Task
│ │ ├── Title
│ │ │ └── Implement OAuth UI
│ │ ├── Executor
│ │ │ └── pr@1
│ │ ├── Dependency
│ │ │ └── Backend: Deploy to Kubernetes
│ │ ├── Context
│ │ │ ├── Repository → web
│ │ │ ├── Credential → github
│ │ │ └── AIProvider → openai
│ │ └── Event
│ │
│ ├── Task
│ │ ├── Title
│ │ │ └── PR Approval
│ │ ├── Executor
│ │ │ └── pr@1
│ │ ├── Dependency
│ │ │ └── Implement Google OAuth API
│ │ ├── Context
│ │ │ ├── Notification → slack
│ │ │ ├── Repository → backend
│ │ │ ├── Credential → github
│ │ │ └── AIProvider → openai
│ │ └── Event
│ │
│ └── Task
│ ├── Title
│ │ └── Deploy to Cloudflare
│ ├── Executor
│ │ └── generic@1
│ ├── Dependency
│ │ └── Web: PR Approval
│ ├── Context
│ │ ├── Notification → slack
│ │ ├── Repository → web
│ │ └── Credential → cloudflare
│ └── Event
│
└── Objective
└── Validation
└── Task
├── Title
│ └── End-to-End Test
├── Executor
│ └── generic@1
├── Dependency
│ ├── Backend: Deploy to Kubernetes
│ └── Web: Deploy to Cloudflare
├── Context
│ └── Notification → slack
└── Event

## Delivery contract

A task `completed` and its candidate `landed` (007.11) — or an objective
`integrated` (007.12) — means the work is **locally landed** in the bare managed
home. It is not yet on the remote. Delivery to the remote is a separate,
explicit `publish repository` step (007.13): human-gated, fast-forward-only, and
never force-pushes a diverged remote. Each repository target has its own
publication state, so a local land is always distinguishable from a completed
remote delivery:

- `unpublished` — landed locally, never pushed.
- `published@<remoteOID>` — pushed; the remote branch is at `<remoteOID>`.
- `diverged` — the remote moved since the last known tip; publish refused the
  non-fast-forward push rather than overwrite it.

The deferred `pr@1` agent (007.12) will call `publish`; until then, publication
is a manual operator step.
