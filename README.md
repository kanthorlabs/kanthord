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
