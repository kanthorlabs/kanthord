import { Command, type Option } from "commander";

import type { CliIo } from "./action.ts";

type Row = {
  command: string;
  description: string;
  flag: string;
  flagDescription: string;
  defaultValue: string;
};

function collectRows(cmd: Command, path: string): Row[] {
  const fullPath = path ? `${path} ${cmd.name()}` : cmd.name();
  const subs = cmd.commands;

  if (subs.length > 0) {
    return subs.flatMap((sub) => collectRows(sub, fullPath));
  }

  const opts: Option[] = cmd.options.filter((o) => o.long !== "--help");

  if (opts.length === 0) {
    return [
      {
        command: fullPath,
        description: cmd.description(),
        flag: "",
        flagDescription: "",
        defaultValue: "",
      },
    ];
  }

  return opts.map((opt, i) => ({
    command: i === 0 ? fullPath : "",
    description: i === 0 ? cmd.description() : "",
    flag: opt.flags,
    flagDescription: opt.description,
    defaultValue:
      opt.defaultValue !== undefined ? String(opt.defaultValue) : "",
  }));
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function buildCommandsCommand(_io: CliIo): Command {
  return new Command("commands")
    .description("Print a table of all commands with their options.")
    .action(function () {
      // `this` is the Command instance; walk up to the root
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let root: Command = this;
      while (root.parent) root = root.parent;

      const rows: Row[] = root.commands.flatMap((sub) =>
        collectRows(sub, root.name()),
      );

      const W = {
        command: Math.max(7, ...rows.map((r) => r.command.length)),
        description: Math.max(11, ...rows.map((r) => r.description.length)),
        flag: Math.max(4, ...rows.map((r) => r.flag.length)),
        flagDescription: Math.max(
          15,
          ...rows.map((r) => r.flagDescription.length),
        ),
        defaultValue: Math.max(7, ...rows.map((r) => r.defaultValue.length)),
      };

      const header =
        pad("Command", W.command) +
        "  " +
        pad("Description", W.description) +
        "  " +
        pad("Flag", W.flag) +
        "  " +
        pad("Flag description", W.flagDescription) +
        "  " +
        "Default";

      const divider =
        "-".repeat(W.command) +
        "  " +
        "-".repeat(W.description) +
        "  " +
        "-".repeat(W.flag) +
        "  " +
        "-".repeat(W.flagDescription) +
        "  " +
        "-".repeat(W.defaultValue || 7);

      console.log(header);
      console.log(divider);
      for (const r of rows) {
        console.log(
          pad(r.command, W.command) +
            "  " +
            pad(r.description, W.description) +
            "  " +
            pad(r.flag, W.flag) +
            "  " +
            pad(r.flagDescription, W.flagDescription) +
            "  " +
            r.defaultValue,
        );
      }
    });
}
