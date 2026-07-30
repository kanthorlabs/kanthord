import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import { DEFAULT_PORT, InvalidPortError, parsePort } from "../serve.ts";
import { requireApiKey, MissingApiKeyError } from "../../http/api-key.ts";
import type { HttpDeps } from "../../http/deps.ts";
import { buildHttpApp } from "../../http/app.ts";
import { startHttpServer } from "../../http/server.ts";
import type { CliIo } from "./action.ts";

export function buildServeCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("serve")
    .description("Serve the kanthord HTTP API and UI on loopback.")
    .configureHelp({ commandUsage: () => "kanthord serve" })
    .option(
      "--port <n>",
      "port to listen on (0 = ephemeral)",
      String(DEFAULT_PORT),
    )
    .addHelpText("after", "\nExample:\n  kanthord serve --port 4100\n")
    .action(async (opts: { port?: string }) => {
      let port: number;
      let apiKey: string;
      try {
        port = parsePort(opts.port);
        apiKey = requireApiKey(process.env["API_KEY"]);
      } catch (err) {
        if (
          err instanceof InvalidPortError ||
          err instanceof MissingApiKeyError
        ) {
          io.err("error: " + err.message + "\n");
          io.setExitCode(1);
          return;
        }
        throw err;
      }

      const httpDeps: HttpDeps = {
        logger: deps.httpLogger,
        getProject: deps.getProject,
        listProjects: deps.listProjects,
        getProjectOverview: deps.getProjectOverview,
        listInitiatives: deps.listInitiatives,
        getInitiative: deps.getInitiative,
        getInitiativeGraph: deps.getInitiativeGraph,
        listObjectives: deps.listObjectives,
        getObjective: deps.getObjective,
        listTasks: deps.listTasks,
        getTask: deps.getTask,
        listResources: deps.listResources,
        getResource: deps.getResource,
        listAiProviders: deps.listAiProviders,
        getAiProvider: deps.getAiProvider,
        resolveProjectChain: deps.resolveProjectChain,
        listModels: deps.listModels,
        getDecisionQueue: deps.getDecisionQueue,
        getConflict: deps.getConflict,
        getObjectiveConflict: deps.getObjectiveConflict,
      };
      const app = buildHttpApp(httpDeps, { apiKey });
      const server = await startHttpServer(app, {
        port,
        logger: deps.httpLogger,
      });

      const stop = (): void => {
        void server.close();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
}
