import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";

interface ResumeRepo {
  setPaused(id: string, paused: boolean): void;
}

interface KindResolver {
  resolveKind(id: string): string | undefined;
}

export class ResumeInitiative {
  readonly #repo: ResumeRepo;
  readonly #resolver: KindResolver;

  constructor(repo: ResumeRepo, resolver: KindResolver) {
    this.#repo = repo;
    this.#resolver = resolver;
  }

  async execute(input: { initiativeId: string }): Promise<void> {
    const kind = this.#resolver.resolveKind(input.initiativeId);
    if (kind === undefined) {
      throw new UnknownReferenceError("initiative", input.initiativeId);
    }
    if (kind !== "initiative") {
      throw new WrongTypeReferenceError("initiative", kind, input.initiativeId);
    }
    this.#repo.setPaused(input.initiativeId, false);
  }
}
