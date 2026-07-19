import type { ProjectRepository } from "../../storage/port.ts";
import type { Notification } from "../../domain/resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import type { UpdateNotificationInput } from "./update-resource.ts";

const IMMUTABLE_FIELDS = ["id", "projectId", "type", "provider"] as const;

export class UpdateNotification {
  readonly #projectRepository: ProjectRepository;

  constructor(projectRepository: ProjectRepository) {
    this.#projectRepository = projectRepository;
  }

  async execute(input: UpdateNotificationInput): Promise<void> {
    const resource = this.#projectRepository.getResource(input.id);
    if (resource === undefined) {
      throw new UnknownReferenceError("resource", input.id);
    }

    const inputRecord: Record<string, unknown> = input;
    const storedRecord = resource as unknown as Record<string, unknown>;
    for (const key of IMMUTABLE_FIELDS) {
      if (key in inputRecord && inputRecord[key] !== storedRecord[key]) {
        throw new ImmutableFieldError(key);
      }
    }

    const notif = resource as Notification;
    const updated: Notification = {
      ...notif,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.destination !== undefined
        ? { destination: input.destination }
        : {}),
    };

    this.#projectRepository.addResource(notif.projectId ?? "", updated);
  }
}
