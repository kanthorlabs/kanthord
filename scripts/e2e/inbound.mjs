export function pollInboundBody({ projectId, repository }) {
  return {
    project_id: projectId,
    kind: "poll",
    platform: "github",
    consumer: "mission.delivery.admit",
    credential: repository.config.credential,
    configuration: {
      resource_kind: "repository",
      resource: repository.github,
    },
  };
}
