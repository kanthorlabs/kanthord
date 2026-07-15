import { createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { DaemonService } from "@/gen/kanthord/v1/daemon_pb.ts";

/**
 * DaemonClient — the strict Connect-Web client type used by all UI components.
 *
 * Typed as Client<typeof DaemonService> so the TypeScript compiler enforces the
 * proto-generated request/response shapes on every call site. UI components that
 * need a view-model projection of the response fields define their own local
 * interfaces and map structurally from the generated types — they do NOT import
 * view-model types from this module.
 */
export type DaemonClient = Client<typeof DaemonService>;

// The daemon's control-plane client. Same-origin by default (the daemon serves
// the bundle over TLS on the VPN interface — SU5), so no CORS. Override the base
// URL via VITE_API_BASE_URL for split dev serving.
export function createDaemonClient(
  baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? "/",
): DaemonClient {
  return createClient(
    DaemonService,
    createConnectTransport({ baseUrl }),
  );
}
