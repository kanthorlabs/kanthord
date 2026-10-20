import { isServerManaged } from "./placement.mjs";

export async function restartServerManaged(
  state,
  { buildImages, saveState, stopDaemon, startDaemon },
) {
  if (!isServerManaged(state.placement))
    throw new Error(`placement ${state.placement} has no daemon pool`);
  if (state.placement === "container") {
    state.image_id = buildImages();
    saveState(state);
  }
  await stopDaemon();
  await startDaemon();
}
