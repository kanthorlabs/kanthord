// src/apps/http/server.ts — startHttpServer: binds 127.0.0.1, no process signal listeners (Story 05).
import type { Server } from "node:http";
import type Koa from "koa";
import type { HttpLogger } from "./logger.ts";

export interface StartedHttpServer {
  readonly port: number;
  /** The bound address, so a test can prove the loopback bind directly. */
  readonly address: string;
  close(): Promise<void>;
}

/** Bind the app to 127.0.0.1. Registers NO process signal handlers. */
export async function startHttpServer(
  app: Koa,
  opts: { readonly port: number; readonly logger: HttpLogger },
): Promise<StartedHttpServer> {
  const server: Server = app.listen(opts.port, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : opts.port;

  opts.logger.info("listening", { port, address: "127.0.0.1" });

  return {
    port,
    address: "127.0.0.1",
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}
