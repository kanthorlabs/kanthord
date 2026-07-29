import { Command } from "commander";

import { buildAddCommand } from "./commands/add.ts";
import { buildAckCommand } from "./commands/ack.ts";
import { buildCommandsCommand } from "./commands/commands.ts";
import { buildApproveCommand } from "./commands/approve.ts";
import { buildAssignCommand } from "./commands/assign.ts";
import { buildCheckCommand } from "./commands/check.ts";
import { processIo } from "./commands/action.ts";
import type { CliIo } from "./commands/action.ts";
import { buildCreateCommand } from "./commands/create.ts";
import { buildDbCommand } from "./commands/db.ts";
import { buildExportCommand } from "./commands/export.ts";
import { buildFindCommand } from "./commands/find.ts";
import { buildGetCommand } from "./commands/get.ts";
import { buildImportCommand } from "./commands/import.ts";
import { buildLandCommand } from "./commands/land.ts";
import { buildListCommand } from "./commands/list.ts";
import { buildLoginCommand } from "./commands/login.ts";
import { buildLogoutCommand } from "./commands/logout.ts";
import { buildPauseCommand } from "./commands/pause.ts";
import { buildPublishCommand } from "./commands/publish.ts";
import { buildQueueCommand } from "./commands/queue.ts";
import { buildRejectCommand } from "./commands/reject.ts";
import { buildAbandonCommand } from "./commands/abandon.ts";
import { buildRegisterCommand } from "./commands/register.ts";
import { buildRemoveCommand } from "./commands/remove.ts";
import { buildRenameCommand } from "./commands/rename.ts";
import { buildResumeCommand } from "./commands/resume.ts";
import { buildRetryCommand } from "./commands/retry.ts";
import { buildRunCommand } from "./commands/run.ts";
import { buildServeCommand } from "./commands/serve.ts";
import { buildSetupCommand } from "./commands/setup.ts";
import { buildTestCommand } from "./commands/test.ts";
import { buildSetDefaultCommand } from "./commands/set-default.ts";
import { buildUnassignCommand } from "./commands/unassign.ts";
import { buildUpdateCommand } from "./commands/update.ts";
import type { CliDeps } from "./deps.ts";
import { packageVersion } from "../version.ts";

/** Build the `kanthord` Commander command tree. */
export function buildProgram(deps: CliDeps, io: CliIo = processIo): Command {
  const create = buildCreateCommand(deps, io).name("create");
  const rename = buildRenameCommand(deps, io).name("rename");
  const pause = buildPauseCommand(deps, io).name("pause");
  const resume = buildResumeCommand(deps, io).name("resume");
  const add = buildAddCommand(deps, io).name("add");
  const ack = buildAckCommand(deps, io).name("ack");
  const assign = buildAssignCommand(deps, io).name("assign");
  const unassign = buildUnassignCommand(deps, io).name("unassign");
  const remove = buildRemoveCommand(deps, io).name("remove");
  const retry = buildRetryCommand(deps, io).name("retry");
  const approve = buildApproveCommand(deps, io).name("approve");
  const reject = buildRejectCommand(deps, io).name("reject");
  const abandon = buildAbandonCommand(deps, io).name("abandon");
  const get = buildGetCommand(deps, io).name("get");
  const find = buildFindCommand(deps, io).name("find");
  const list = buildListCommand(deps, io).name("list");
  const update = buildUpdateCommand(deps, io).name("update");
  const importCommand = buildImportCommand(deps, io).name("import");
  const exportCommand = buildExportCommand(deps, io).name("export");
  const login = buildLoginCommand(deps, io).name("login");
  const logout = buildLogoutCommand(deps, io).name("logout");
  const register = buildRegisterCommand(deps, io).name("register");
  const setDefault = buildSetDefaultCommand(deps, io).name("set-default");
  const run = buildRunCommand(deps, io).name("run");
  const setup = buildSetupCommand(deps, io).name("setup");
  const land = buildLandCommand(deps, io).name("land");
  const publish = buildPublishCommand(deps, io).name("publish");
  const test = buildTestCommand(deps, io).name("test");
  const commands = buildCommandsCommand(io);
  const queue = buildQueueCommand(deps, io).name("queue");
  const serve = buildServeCommand(deps, io).name("serve");

  return new Command()
    .name("kanthord")
    .description(
      "Kanthord - Kanthor's agentic program does the work with an opinionated setup.",
    )
    .version(packageVersion)
    .showHelpAfterError()
    .addCommand(buildCheckCommand(deps, io))
    .addCommand(create)
    .addCommand(buildDbCommand(deps, io))
    .addCommand(rename)
    .addCommand(pause)
    .addCommand(resume)
    .addCommand(add)
    .addCommand(ack)
    .addCommand(assign)
    .addCommand(unassign)
    .addCommand(remove)
    .addCommand(retry)
    .addCommand(approve)
    .addCommand(reject)
    .addCommand(abandon)
    .addCommand(get)
    .addCommand(find)
    .addCommand(list)
    .addCommand(update)
    .addCommand(importCommand)
    .addCommand(exportCommand)
    .addCommand(login)
    .addCommand(logout)
    .addCommand(register)
    .addCommand(setDefault)
    .addCommand(run)
    .addCommand(setup)
    .addCommand(land)
    .addCommand(publish)
    .addCommand(test)
    .addCommand(commands)
    .addCommand(serve)
    .addCommand(queue);
}
