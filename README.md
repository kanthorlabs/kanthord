# kanthord
> Kanthor's agentic program does the work with an opinionated setup. The D mean daemon, same meaning in systemd :D
> We need to build a reliable system from unreliable components. - Chapter 8, Designing Data-Intensive Applications, Martin Kleppmann.

kanthord is a long-running daemon that executes software-engineering work **across multiple repositories** on behalf of one engineer, reducing the human's workload to only the work that requires a human. Single-repo agentic coding is a commodity; kanthord's reason to exist is the **cross-repo feature orchestration layer**.

## Architecture

### Graph

Project
├── Resource
│   ├── Repository
│   ├── Credential
│   ├── Notification
│   ├── AIProvider
│   └── Filesystem
│
├── Agent
│   ├── SoftwareEngineer
│   ├── ReviewerEngineer
│   └── TestEngineer
│
└── Initiative
    └── Objective
        └── Task
            ├── Dependencies (other Task)
            ├── Context (Project Resource Binding)
            └── Event

### Example

Project
├── Resource
│   ├── Repository
│   │   ├── backend
│   │   └── web
│   │
│   ├── Credential
│   │   ├── github
│   │   ├── kubernetes
│   │   └── cloudflare
│   │
│   ├── Notification
│   │   └── slack
│   │
│   ├── AIProvider
│   │   └── openai
│   │
│   └── Filesystem
│
├── Agent
│   ├── TestEngineer
│   ├── SoftwareEngineer
│   ├── ReviewerEngineer
│   └── Generic
│
└── Initiative
    └── OAuth Integration
        ├── Objective
        │   └── Backend
        │       ├── Task
        │       │   ├── Title
        │       │   │   └── Implement Google OAuth API
        │       │   ├── Agent
        │       │   │   ├── TestEngineer
        │       │   │   ├── SoftwareEngineer
        │       │   │   └── ReviewerEngineer
        │       │   ├── Workflow
        │       │   │   └── tdd@1
        │       │   ├── Context
        │       │   │   ├── Repository → backend
        │       │   │   ├── Credential → github
        │       │   │   └── AIProvider → openai
        │       │   └── Event
        │       │
        │       ├── Task
        │       │   ├── Title
        │       │   │   └── PR Approval
        │       │   ├── Agent
        │       │   │   └── Generic
        │       │   ├── Workflow
        │       │   │   └── pr@1
        │       │   ├── Dependency
        │       │   │   └── Implement Google OAuth API
        │       │   ├── Context
                    │   ├── Notification → slack
        │       │   │   ├── Repository → backend
        │       │   │   ├── Credential → github
        │       │   │   └── AIProvider → openai
        │       │   └── Event
        │       │
        │       └── Task
        │           ├── Title
        │           │   └── Deploy to Kubernetes
        │           ├── Agent
        │           │   └── Generic
        │           ├── Workflow
        │           │   └── k8s@1
        │           ├── Dependency
                    │   ├── Notification → slack
        │           │   └── Backend: PR Approval
        │           ├── Context
        │           │   └── Credential → kubernetes
        │           └── Event
        │
        ├── Objective
        │   └── Web
        │       ├── Task
        │       │   ├── Title
        │       │   │   └── Implement OAuth UI
        │       │   ├── Agent
        │       │   │   ├── TestEngineer
        │       │   │   ├── SoftwareEngineer
        │       │   │   └── ReviewerEngineer
        │       │   ├── Workflow
        │       │   │   └── pr@1
        │       │   ├── Dependency
        │       │   │   └── Backend: Deploy to Kubernetes
        │       │   ├── Context
        │       │   │   ├── Repository → web
        │       │   │   ├── Credential → github
        │       │   │   └── AIProvider → openai
        │       │   └── Event
        │       │
        │       ├── Task
        │       │   ├── Title
        │       │   │   └── PR Approval
        │       │   ├── Agent
        │       │   │   └── Generic
        │       │   ├── Workflow
        │       │   │   └── pr@1
        │       │   ├── Dependency
        │       │   │   └── Implement Google OAuth API
        │       │   ├── Context
                    │   ├── Notification → slack
        │       │   │   ├── Repository → backend
        │       │   │   ├── Credential → github
        │       │   │   ├── AIProvider → openai
        │       │   └── Event
        │       │
        │       └── Task
        │           ├── Title
        │           │   └── Deploy to Cloudflare
        │           ├── Agent
        │           │   └── SoftwareEngineer
        │           ├── Dependency
        │           │   └── Web: PR Approval
        │           ├── Context
                    │   ├── Notification → slack
        │           │   ├── Repository → web
        │           │   └── Credential → cloudflare
        │           └── Event
        │
        └── Objective
            └── Validation
                ├── Task
                    ├── Title
                    │   └── End-to-End Test
                    ├── Agent
                    │   └── Generic
                    ├── Dependency
                    │   ├── Backend: Deploy to Kubernetes
                    │   └── Web: Deploy to Cloudflare
                    ├── Context
                    │   └── Notification → slack
                    └── Event
### Abstraction

```js
interface Entity {
  id: ULID;
}
interface Project extends Entity {
  name: string;
  resources: Resource[];
  agents: Agent[];
  initiatives: Initiative[];
}
enum ResourceType {
  Repository = "repository",
  Credential = "credential",
  Notification = "notification",
  AIProvider = "ai_provider",
  Filesystem = "filesystem",
}
interface Resource extends Entity {
  name: string;
  type: ResourceType;
}
interface Repository extends Resource {
  type: ResourceType.Repository;
  organization: string;
  name: string;
  branch: string;
}
interface Credential extends Resource {
  type: ResourceType.Credential;
  provider: string;
  secretRef: string;
}
interface Notification extends Resource {
  type: ResourceType.Notification;
  provider: "slack" | "telegram";
  destination: string;
}
interface AIProvider extends Resource {
  type: ResourceType.AIProvider;
  provider: string;
  model: string;
}
interface Filesystem extends Resource {
  type: ResourceType.Filesystem;
  path: string;
}
enum AgentType {
  SoftwareEngineer = "software_engineer",
  ReviewerEngineer = "reviewer_engineer",
  TestEngineer = "test_engineer",
}
interface Agent extends Entity {
  name: string;
  type: AgentType;
  execute(
    task: Task,
    context: TaskContext,
  ): Promise<TaskResult>;
}
interface Initiative extends Entity {
  name: string;
  objectives: Objective[];
}
interface Objective extends Entity {
  name: string;
  tasks: Task[];
}
enum TaskStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}
interface Task<T = unknown> extends Entity {
  title: string;
  status: TaskStatus;
  agent: Agent;
  context: TaskContext;
  dependencies: Task[];
  events: Event[];
  execute(): Promise<TaskResult<T>>;
}
interface TaskContext {
  resources: Resource[];
  getResource<T extends Resource>(
    type: ResourceType,
  ): T;
}
interface TaskResult<T = unknown> {
  output?: T;
  error?: Error;
}
enum EventType {
  // TBD
}
interface Event extends Entity {
  taskId: string;
  type: EventType;
  timestamp: Date;
  payload?: unknown;
}
```
