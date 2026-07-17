import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  AmbiguousNameError,
  CycleError,
  DependenciesLockedError,
} from "../../app/errors.ts";
import { TaskNotRetryableError } from "../../app/task/retry-task.ts";

export class MissingFlagError extends Error {
  readonly flag: string;

  constructor(flag: string) {
    super(`missing required flag ${flag}`);
    this.name = "MissingFlagError";
    this.flag = flag;
  }
}

export function toResult(err: unknown): { exitCode: number; stderr: string[] } {
  if (
    err instanceof UnknownReferenceError ||
    err instanceof WrongTypeReferenceError ||
    err instanceof DuplicateNameError ||
    err instanceof AmbiguousNameError ||
    err instanceof MissingFlagError ||
    err instanceof CycleError ||
    err instanceof DependenciesLockedError ||
    err instanceof TaskNotRetryableError
  ) {
    return { exitCode: 1, stderr: [`error: ${err.message}`] };
  }
  throw err;
}
