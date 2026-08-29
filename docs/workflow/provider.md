# Provider workflows

These sequence diagrams describe the **planned live-mode dashboard flow** across the transport foundation, provider CRUD, subscription login, and provider readiness plans.

> **Contract status:** the vendored API snapshot in `apps/docs/api/contract/manifest.json` is version `27.8.1`. It declares the existing provider CRUD operations, but not yet `provider.verify`, the three login operations, or the OAuth registration arm. Those interactions below are target-state behavior from the plans and require the planned contract refresh. The existing contract remains authoritative for `provider.register`: `POST /v1/provider`.

## Participants and invariants

The sequence diagrams use a **blue band for dashboard/frontend elements** and an **amber band for engine/backend elements**. The user and vendor services sit outside both bands because they are external actors.

- UI components call typed `ProviderResource` functions; they do not construct paths, headers, or raw `fetch` calls.
- A catalogued `pi-ai` provider carries a fixed base URL and static models. The form renders no base-URL input for it and sends `baseUrl: null`; the engine selects the fixed endpoint by provider id. Only `openai-compatible` renders an editable, required base URL.
- `ApiClient` is the only HTTP seam. In live mode it adds the bearer token and operation-specific idempotency key and decodes the common error envelope. In offline mode the same resource calls are dispatched to stateful fixtures instead.
- A secret is never returned in a provider view. API keys and OAuth credentials are encrypted at rest. The UI must not put them in logs, browser storage, URL state, or telemetry.
- Registration, rename, inspect, and verification use memory idempotency. A transport retry reuses the intent's key; a deliberate re-verification uses a new key or no key.
- A provider cannot be edited optimistically. The list and detail views update from the daemon response.

## 1. Register a new API-key provider

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    box rgb(232,240,254) Dashboard / frontend
        participant P as Providers page
        participant F as Register form
        participant H as Registration hook
        participant R as ProviderResource
        participant C as ApiClient / fetch seam
    end
    box rgb(255,243,224) Engine / backend
        participant A as kanthord HTTP API
        participant Q as Catalog / inspect query
        participant M as registerProvider command
        participant S as Crypto + SQLite + event log
    end
    participant V as LLM vendor endpoint

    U->>P: Select "Register provider"
    P->>F: Open form
    F->>R: catalog()
    R->>C: request(provider.catalog, query)
    C->>A: GET /v1/provider/llm
    A->>Q: Read provider catalogue
    Q-->>A: Vendors, static models, baseUrl requirement, OAuth capability
    A-->>C: 200 catalogue
    C-->>R: Typed catalogue
    R-->>F: Populate provider select

    U->>F: Choose LLM + API key
    U->>F: Enter name, vendor, API key, and model
    Note over F: Vendor change clears model and stale base URL.<br/>Branch change or form close clears every secret.

    alt Vendor is openai-compatible
        F-->>U: Show required, editable base URL and "Test connection"
        U->>F: Enter the endpoint base URL
        U->>F: Select "Test connection"
        F->>R: inspect(provider, baseUrl, apiKey)
        R->>C: request(provider.inspect, body)
        C->>A: POST /v1/provider/inspect + Idempotency-Key
        A->>Q: Discover models with supplied form values
        Q->>V: List endpoint models
        V-->>Q: Model identifiers or failure
        Q-->>A: models[] or refusal
        A-->>C: 200 models / error envelope
        C-->>R: Typed models or ApiError
        R-->>F: Populate model select, count, or field/form error
        Note over F: Changing provider, URL, key, or model invalidates this result.<br/>The result is not stored as provider verification.
    else Vendor is catalogued by pi-ai
        F-->>U: Show static model choices with no base-URL input
        Note over F: The catalog endpoint is fixed and cannot be overridden.<br/>Registration sends baseUrl:null.
    end

    U->>F: Select "Register"
    F->>H: submit current branch
    H->>H: Disable submit and serialize once
    H->>R: register({name, kind:"llm", payload:{transport:"api-key", provider, apiKey, defaultModel, baseUrl}})
    R->>C: request(provider.register, body)
    C->>A: POST /v1/provider + Idempotency-Key
    alt Registration accepted
        A->>M: Authenticate, validate, invoke command
        M->>M: Validate name, catalogue provider, and base URL rule
        M->>S: Encrypt payload and insert provider + events in one transaction
        Note over M,S: The first LLM provider is stamped as default automatically.
        S-->>M: Committed ProviderView state
        M-->>A: ProviderView with non-secret api-key projection
        A-->>C: 200 ProviderView
        C-->>R: Typed ProviderView
        R-->>H: Registration result
        H->>H: Clear API key
        H-->>F: Close form
        F-->>P: Insert/replace row from returned ProviderView
        P-->>U: Show provider and default marker, if set
    else Registration refused or transport fails
        A-->>C: Error envelope
        C-->>R: ApiError with code, refusal, and issues
        R-->>H: Registration refused
        H->>H: Keep non-secret fields and clear API key
        H-->>F: Map name-taken or payload issues to fields, otherwise show a form error
        F-->>U: Explain the refusal and allow a human retry
    end
```

**Important:** ordinary API-key registration does not contact the vendor. A catalogued `pi-ai` provider uses its fixed endpoint and static model list; the dashboard neither renders nor submits an override. Only `openai-compatible` accepts a human-entered base URL, and only its visible **Test connection** control calls `provider.inspect`. After registration, the user can run `provider.verify` from the detail panel to probe the stored default model.

## 2. Register a new subscription provider

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    box rgb(232,240,254) Dashboard / frontend
        participant F as Register form
        participant L as Subscription login page
        participant H as useSubscriptionLogin
        participant R as ProviderResource
        participant C as ApiClient / fetch seam
        participant P as Providers page
    end
    box rgb(255,243,224) Engine / backend
        participant A as kanthord HTTP API
        participant PA as Provider-auth service / pi-ai
        participant S as Encrypted provider_login + provider store
        participant M as registerProvider command
    end
    participant V as Vendor authorization service

    U->>F: Choose LLM vendor and "Subscription"
    Note over F: Subscription is offered only when catalogue.oauth is non-null.
    F->>L: Open subscription login flow with provider and name
    U->>L: Select "Continue with subscription"
    L->>H: start(provider, optional prompt answers)
    H->>R: loginStart({provider, answers?})
    R->>C: request(provider.loginStart, body)
    C->>A: POST /v1/provider/login
    alt Login starts
        A->>PA: Start vendor OAuth interaction
        PA->>S: Create one pending login row for this vendor
        PA->>V: Begin library-owned OAuth/device flow
        V-->>PA: Authorization URL or device challenge
        PA-->>A: LoginChallenge
        A-->>C: 200 manual-code or device-code challenge
        C-->>R: Typed challenge
        R-->>H: Login challenge
    else Vendor requires an additional answer
        A-->>C: 400 login-input-required + prompt in detail
        C-->>R: ApiError
        R-->>H: Refusal
        H-->>L: Render prompt
        U->>L: Enter answer
        L->>H: Retry start with answers map
        Note over H,A: Retry follows the same loginStart path.
    else Another login for the vendor is pending
        A-->>C: 400 login-in-progress
        C-->>R: ApiError
        R-->>H: Refusal with expiry
        H-->>L: Show countdown and explicit cancel action
        opt User cancels
            U->>L: Select "Cancel this login"
            L->>H: cancel(loginId)
            H->>R: loginCancel({loginId})
            R->>C: request(provider.loginCancel, body)
            C->>A: POST /v1/provider/login/cancel
            A->>PA: Abort callback server/vendor poll
            PA->>S: Delete pending/completed login row
            A-->>C: 204 No Content
            C-->>R: void
            R-->>H: Cancelled
            H-->>L: Login ended
        end
    end

    Note over H,L: The remaining flow applies after loginStart returns a challenge.
    alt Manual-code challenge
        H-->>L: authUrl link, instructions, expiry, code field
        L-->>U: Show link and code input, with submit enabled when empty
        U->>V: Open authUrl and authorize account
        V-->>PA: Callback may complete the library-owned flow
        U->>L: Optionally paste code, then select "Continue"
        L->>H: complete(loginId, code?)
        H->>R: loginComplete({loginId, code?})
        R->>C: request(provider.loginComplete, body)
        C->>A: POST /v1/provider/login/complete
        A->>PA: Supply pasted code or read callback-completed state
        alt Manual flow is still suspended and code is absent
            A-->>C: 400 code-required
            C-->>R: ApiError
            R-->>H: Keep challenge active
            H-->>L: Ask for the code without discarding the login
        else Login expired or daemon lost its in-process flow
            A-->>C: 400 login-expired or login-lost
            C-->>R: ApiError
            R-->>H: Distinct refusal
            H-->>L: Explain expiry/loss and require a new login
        else Manual flow completed
            PA->>S: Encrypt credential and exact model IDs, then mark login completed
            A-->>C: 200 {loginId, models}
            C-->>R: Typed completion
            R-->>H: Completion result
        end
    else Device-code challenge
        H-->>L: userCode, verificationUri, expiresAt, pollIntervalMs
        L-->>U: Show code, link, and countdown
        U->>V: Open verificationUri, enter userCode, authorize
        loop Every pollIntervalMs until completion or expiry
            H->>R: loginComplete({loginId})
            R->>C: request(provider.loginComplete, body)
            C->>A: POST /v1/provider/login/complete
            A->>PA: Read in-process flow state
            alt Vendor flow is still pending
                A-->>C: 400 login-pending
                C-->>R: ApiError
                R-->>H: Normal polling result, not a visible error
            else Login expired or daemon lost its in-process flow
                A-->>C: 400 login-expired or login-lost
                C-->>R: ApiError
                R-->>H: Stop polling and explain that a new login is required
            else Vendor flow completed
                PA->>S: Encrypt credential and exact model IDs, then mark login completed
                A-->>C: 200 {loginId, models}
                C-->>R: Typed completion
                R-->>H: Completion result
            end
        end
    end

    H-->>L: Show available-model select
    U->>L: Choose default model and confirm registration
    L->>H: register(name, loginId, defaultModel)
    H->>R: register({transport:"oauth", loginId, name, defaultModel})
    R->>C: request(provider.register, body)
    C->>A: POST /v1/provider + Idempotency-Key
    alt Completed login exists and registration is accepted
        A->>M: Consume completed login
        M->>S: Create encrypted provider and delete login row in one transaction
        Note over M,S: No access token, refresh token, code, or loginId is returned.<br/>The first LLM provider becomes default automatically.
        S-->>M: Committed ProviderView
        M-->>A: OAuth projection {transport, provider, defaultModel}
        A-->>C: 200 ProviderView
        C-->>R: Typed ProviderView
        R-->>H: Registration result
        H-->>P: Add row from daemon response
        P-->>U: Show registered subscription provider
    else loginId was consumed or does not exist
        A-->>C: 404 not-found
        C-->>R: ApiError
        R-->>H: Login is gone
        H-->>L: Explain that a new login is required
    else Registration is refused
        A-->>C: Error envelope
        C-->>R: ApiError
        R-->>H: Registration refused
        H-->>L: Keep non-secret choices and explain the refusal
    end
```

A pending or completed login is not itself a provider. The provider row exists only after `provider.register` succeeds and consumes the `loginId`.

## 3. Edit an existing API-key provider

The API has no update operation for the vendor, API key, base URL, or default model. “Edit” therefore means **rename**, optionally **make global default**, and **verify the stored credential**. Credential rotation or configuration replacement is remove-then-register.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    box rgb(232,240,254) Dashboard / frontend
        participant P as Providers page
        participant D as Provider detail panel
        participant R as ProviderResource
        participant C as ApiClient / fetch seam
    end
    box rgb(255,243,224) Engine / backend
        participant A as kanthord HTTP API
        participant M as Provider command/query
        participant S as Crypto + SQLite + event log
        participant PA as Provider-auth service / pi-ai
    end
    participant V as LLM vendor endpoint

    U->>P: Open an API-key provider
    P->>R: show(id)
    R->>C: request(provider.show, path)
    C->>A: GET /v1/provider/{id}
    A->>S: Read and decrypt projection
    S-->>A: ProviderView without API key
    A-->>C: 200 ProviderView
    C-->>R: Typed ProviderView
    R-->>D: Detail data
    D-->>U: Show name, vendor, default model, base URL, and actions
    Note over D,U: There is no credential revealer and no editable API-key field.

    alt Rename
        U->>D: Edit name and save
        D->>R: rename(id, name)
        R->>C: request(provider.rename, path + body)
        C->>A: POST /v1/provider/{id}/rename + Idempotency-Key<br/>{name}
        A->>M: renameProvider
        M->>S: Enforce unique name, update row, and append event transactionally
        S-->>M: Committed ProviderView
        M-->>A: ProviderView
        A-->>C: 200 ProviderView
        C-->>R: Typed ProviderView
        R-->>D: Replace detail/list data from response
        D-->>U: Show saved name
        opt Name is already used
            A-->>C: 400 invalid-request / name-taken
            C-->>R: ApiError
            R-->>D: Attach refusal to name field
        end
    else Make default
        U->>D: Select "Make default" and confirm
        D->>R: setDefault(id)
        R->>C: request(provider.setDefault, path)
        C->>A: PUT /v1/provider/{id}/default
        A->>M: Transfer default in one transaction
        M->>S: Clear previous holder, stamp target, append events
        S-->>M: ProviderView + displaced[]
        M-->>A: Result
        A-->>C: 200 result
        C-->>R: Typed result
        R-->>D: ProviderView + displaced[]
        D-->>U: Show new default and named displaced provider, when present
    else Verify stored credential
        U->>D: Select "Verify" / "Re-verify"
        D->>R: verify({providerId:id}, fresh key or no key)
        R->>C: request(provider.verify, path)
        C->>A: POST /v1/provider/{provider}/verify
        A->>M: Read encrypted registration snapshot
        M->>S: Decrypt stored API-key payload
        M->>PA: Probe stored default model
        PA->>V: Completion "What time is it?" capped at 16 tokens
        V-->>PA: Completion or classified failure
        PA-->>M: Closed probe outcome
        M-->>A: Verdict with no persistence
        A-->>C: 200 verification verdict
        C-->>R: Typed verdict
        R-->>D: Verification result
        D-->>U: Show checkedAt/model and reachability, authentication, completed, refusal rows
    else Change key, vendor, base URL, or model
        D-->>U: No in-place edit exists, use remove then API-key registration
    end
```

A verification verdict is transient. It must be cleared when provider data changes and must not be rendered later as a persisted “healthy” or “ready” status.

## 4. Edit an existing subscription provider

A subscription registration has the same writable surface as an API-key registration. The dashboard cannot reveal tokens, manually refresh them, change the authenticated account, or change the stored model in place.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    box rgb(232,240,254) Dashboard / frontend
        participant P as Providers page
        participant D as Provider detail panel
        participant R as ProviderResource
        participant C as ApiClient / fetch seam
    end
    box rgb(255,243,224) Engine / backend
        participant A as kanthord HTTP API
        participant M as Provider command/query
        participant CS as Encrypted CredentialStore + SQLite
        participant PA as Provider-auth service / pi-ai
    end
    participant V as Vendor authorization / LLM service

    U->>P: Open a subscription provider
    P->>R: show(id)
    R->>C: request(provider.show, path)
    C->>A: GET /v1/provider/{id}
    A->>CS: Read non-secret OAuth projection
    CS-->>A: {transport:"oauth", provider, defaultModel}
    A-->>C: 200 ProviderView
    C-->>R: Typed ProviderView
    R-->>D: Detail data
    D-->>U: Show name, vendor, default model, default state, and actions
    Note over D,U: No access token, refresh token, base URL, or credential revealer is rendered.

    alt Rename
        U->>D: Edit name and save
        D->>R: rename(id, name)
        R->>C: request(provider.rename, path + body)
        C->>A: POST /v1/provider/{id}/rename + Idempotency-Key
        A->>M: renameProvider
        M->>CS: Enforce unique name, update row, and append event
        CS-->>M: Committed ProviderView
        M-->>A: ProviderView
        A-->>C: 200 ProviderView
        C-->>R: Typed ProviderView
        R-->>D: Rename result
        D-->>P: Replace list/detail data from response
    else Make default
        U->>D: Select "Make default" and confirm
        D->>R: setDefault(id)
        R->>C: request(provider.setDefault, path)
        C->>A: PUT /v1/provider/{id}/default
        A->>M: Transfer default transactionally
        M->>CS: Clear old holder and stamp target
        CS-->>M: ProviderView + displaced[]
        M-->>A: Result
        A-->>C: 200 result
        C-->>R: Typed result
        R-->>D: ProviderView + displaced[]
        D-->>U: Show new default and displaced provider
    else Verify / re-verify subscription
        U->>D: Select "Verify" / "Re-verify"
        D->>R: verify({providerId:id}, fresh key or no key)
        R->>C: request(provider.verify, path)
        C->>A: POST /v1/provider/{provider}/verify
        A->>M: Verify stored registration snapshot
        M->>CS: Decrypt OAuth credential
        M->>PA: Resolve auth and probe stored default model
        opt Access token needs refresh
            PA->>V: Library-owned token refresh
            V-->>PA: Refreshed credential or rejection
            PA->>CS: Re-encrypt refreshed credential + append credentialRefreshed event
        end
        PA->>V: Completion "What time is it?" capped at 16 tokens
        V-->>PA: Completion or classified failure
        PA-->>M: Closed probe outcome
        M-->>A: Transient verdict
        A-->>C: 200 verdict / refusal / service error
        C-->>R: Typed verdict or ApiError
        R-->>D: Verification result
        D-->>U: Show full verification table, not a pass/fail badge
    else Change account, re-login, or change default model
        D-->>U: No in-place operation exists, remove and repeat subscription registration
    end
```

OAuth refresh is backend-owned and may occur while `pi-ai` resolves a credential. There is deliberately no refresh button or refresh API in the dashboard.

## 5. Delete a default provider

Deleting a provider whose `setDefaultAt` is non-null is guarded **before** the delete call. The preferred path transfers the default first. The explicit override can leave the LLM chain without a default and overrides only the `default-chain` blocker.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    box rgb(232,240,254) Dashboard / frontend
        participant D as Provider detail panel
        participant G as Remove-default alert dialog
        participant H as useProviderRemoval
        participant R as ProviderResource
        participant C as ApiClient / fetch seam
        participant P as Providers page
    end
    box rgb(255,243,224) Engine / backend
        participant A as kanthord HTTP API
        participant M as setDefault/remove commands
        participant S as SQLite + event log
    end

    U->>D: Select "Remove provider"
    D->>H: requestRemoval(target, currentProviderList)
    H->>H: Detect target.setDefaultAt is non-null
    H-->>G: Open guarded dialog with available choices
    G-->>U: Explain that target holds the default
    Note over G: Candidate chooser contains only other LLM providers.<br/>If none exist, explain why transfer is unavailable.<br/>Always offer cancel and the explicit remove-anyway path.

    alt Preferred: transfer default, then remove
        U->>G: Choose named successor and confirm transfer
        G->>H: transferThenRemove(successor)
        H->>R: setDefault(successor.id)
        R->>C: request(provider.setDefault, path)
        C->>A: PUT /v1/provider/{successorId}/default
        A->>M: setDefaultProvider
        M->>S: Clear old holder, stamp successor, append unset/set events atomically
        S-->>M: Successor ProviderView + displaced[target]
        M-->>A: Result
        A-->>C: 200 result
        C-->>R: Typed result
        R-->>H: Transfer succeeded
        H->>R: remove(target.id)
        R->>C: request(provider.remove, path)
        C->>A: DELETE /v1/provider/{targetId}
        A->>M: removeProvider(force=false)
        M->>S: Check all blockers, delete row, and append removed event
        alt Removal succeeds
            S-->>A: Committed {id}
            A-->>C: 200 {id}
            C-->>R: Typed removal result
            R-->>H: Removal succeeded
            H-->>P: Remove target and mark successor default
            P-->>U: Show completed transfer and removal
        else Removal is blocked after transfer
            A-->>C: 409 binding-in-use + blockers
            C-->>R: ApiError
            R-->>H: Removal refused
            H-->>G: Report both facts: default moved, target still exists
            G-->>U: List project, repository, or attempt blockers, with no rollback
        end
    else Explicit override: remove default anyway
        U->>G: Confirm "Remove it even though it is the default"
        G->>H: forceRemove()
        H->>R: remove(target.id, {force:"true"})
        R->>C: request(provider.remove, path + literal query)
        C->>A: DELETE /v1/provider/{targetId}?force=true
        A->>M: removeProvider(force=true)
        M->>S: Suppress default-chain blocker only and check other references
        alt No project, repository, or attempt blocker
            S->>S: Delete provider + append provider.removed atomically
            S-->>A: {id}
            A-->>C: 200 {id}
            C-->>R: Typed removal result
            R-->>H: Removal succeeded
            H-->>P: Remove row
            H-->>G: chainHeadless=true + remaining LLM provider names
            G-->>U: Explain there is no default and prompt for a remaining LLM
            opt User appoints a new default
                U->>G: Choose provider
                G->>H: setDefault(chosen.id)
                H->>R: setDefault(chosen.id)
                R->>C: request(provider.setDefault, path)
                C->>A: PUT /v1/provider/{chosenId}/default
                A->>M: setDefaultProvider
                M->>S: Stamp chosen provider + append event
                S-->>M: Committed ProviderView + displaced[]
                M-->>A: Result
                A-->>C: 200 result
                C-->>R: Typed result
                R-->>H: Default assigned
                H-->>G: Update dialog state
                G-->>U: Show new default
            end
        else Another blocker remains
            S-->>A: Blocker list without default-chain
            A-->>C: 409 binding-in-use
            C-->>R: ApiError with blockers
            R-->>H: Removal refused
            H-->>G: Keep provider and render blockers
            G-->>U: Clear project/repository/attempt references manually
        end
    else Cancel
        U->>G: Cancel or press Escape
        G-->>H: Abort choice
        H-->>D: No request and no state change
    end
```

### Deletion outcomes

| Choice | Result |
| --- | --- |
| Transfer first | The selected LLM becomes default, then the old provider is removed if no other blocker exists. If removal fails, the transfer remains and the UI reports both facts. |
| Remove anyway | `force=true` ignores only `default-chain`. On success, no provider is default until the user appoints one. |
| Other blockers | `project-binding`, `repository`, and `attempt` always refuse deletion, even with `force=true`; the UI lists them and never auto-resolves them. |
| Cancel | No HTTP request and no state change. |

## Source material

- `apps/.agents/plan/transport-foundation--01m13wjg35r6akr4fh41a4zj17`
- `apps/.agents/plan/subscription-login--01m13wjg5pb5nabbtb8t2v2bxf`
- `apps/.agents/plan/provider-crud--01m13wjg401jqj8xezaph3s633`
- `apps/.agents/plan/provider-readiness--01m13wjg520a3qwh4a5xz8c9f0`
- `apps/docs/api/operations.md`, `errors.md`, and `contract/features/provider.yaml`
