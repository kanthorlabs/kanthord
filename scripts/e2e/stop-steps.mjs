export async function stopRun(
  state,
  stopDaemon,
  { pauseProject, stopInstances, stopDevDaemon, requireNoContainers, log },
) {
  if (!stopDaemon) {
    const project = await pauseProject();
    log(`e2e-stop: project ${project.id} paused`);
    return;
  }
  if (state.placement === "worker")
    for (const instance of await stopInstances())
      log(
        `e2e-stop: ${instance.name}${instance.pid ? ` pid ${instance.pid}` : ""} ${instance.result}`,
      );
  await stopDevDaemon();
  if (state.placement === "container") {
    await requireNoContainers();
    log("e2e-stop: no container with the owner label remains");
  }
}
