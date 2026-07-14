import { createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { DaemonService } from "@/gen/kanthord/v1/daemon_pb.ts";

// The daemon's control-plane client. Same-origin by default (the daemon serves
// the bundle over TLS on the VPN interface — SU5), so no CORS. Override the base
// URL via VITE_API_BASE_URL for split dev serving.
export function createDaemonClient(
  baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? "/",
): Client<typeof DaemonService> {
  return createClient(DaemonService, createConnectTransport({ baseUrl }));
}

export type DaemonClient = Client<typeof DaemonService>;
