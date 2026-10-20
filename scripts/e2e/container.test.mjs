import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTAINER_IMAGE,
  requireContainerImage,
  workerContainerImage,
} from "./dev-config.mjs";
import { buildDevImages, currentImageId, imageIdField } from "./images.mjs";
import { isServerManaged, PLACEMENTS } from "./placement.mjs";
import { restartServerManaged } from "./restart-steps.mjs";
import {
  containerRuntime,
  ownedContainers,
  requireNoOwnedContainers,
} from "./slot-containers.mjs";

const CONFIG_FILE = "/home/dev/.config/kanthord/kanthord.yaml";
const IMAGE_ID = "sha256:0123abcd";

function configWith(workerLines) {
  return `gateway:\n  bind: 127.0.0.1\nworker:\n${workerLines}scheduler:\n  release_reserve: 600\n`;
}

test("a dev config with the dev image passes", () => {
  const text = configWith(
    `  heartbeat_window: 300\n  container_image: ${CONTAINER_IMAGE}\n`,
  );
  assert.equal(workerContainerImage(text), CONTAINER_IMAGE);
  requireContainerImage(text, CONFIG_FILE);
  requireContainerImage(
    configWith(`  container_image: "${CONTAINER_IMAGE}"\n`),
    CONFIG_FILE,
  );
});

test("a dev config without the dev image is refused with the exact line", () => {
  const refused = [
    configWith("  heartbeat_window: 300\n"),
    configWith("  container_image: docker.io/kanthorlabs/kanthord\n"),
    `other:\n  container_image: ${CONTAINER_IMAGE}\nworker:\n  heartbeat_window: 300\n`,
    "",
  ];
  for (const text of refused)
    assert.throws(
      () => requireContainerImage(text, CONFIG_FILE),
      (error) =>
        error.message.includes(CONFIG_FILE) &&
        error.message.includes(`container_image: ${CONTAINER_IMAGE}`),
    );
});

test("the container placement is server-managed", () => {
  assert.deepEqual(PLACEMENTS, ["server", "worker", "container"]);
  assert.equal(isServerManaged("server"), true);
  assert.equal(isServerManaged("container"), true);
  assert.equal(isServerManaged("worker"), false);
});

test("buildDevImages runs images.sh build and returns the image id", () => {
  const calls = [];
  const exec = (file, args) => {
    calls.push([file, ...args]);
    return `noise\nimage_id ${IMAGE_ID}\n`;
  };
  assert.equal(buildDevImages("/repo", exec), IMAGE_ID);
  assert.deepEqual(calls, [["/repo/scripts/e2e/images.sh", "build"]]);
  assert.equal(currentImageId("/repo", exec), IMAGE_ID);
  assert.deepEqual(calls.at(-1), ["/repo/scripts/e2e/images.sh", "id"]);
});

test("images.sh without an image_id line is an error", () => {
  assert.throws(() => buildDevImages("/repo", () => "done\n"), /image_id/);
});

test("run.json carries the image id at the container placement only", () => {
  const exec = () => `image_id ${IMAGE_ID}\n`;
  assert.deepEqual(imageIdField("container", "/repo", exec), {
    image_id: IMAGE_ID,
  });
  assert.deepEqual(imageIdField("server", "/repo", exec), {});
  assert.deepEqual(imageIdField("worker", "/repo", exec), {});
});

function restartSteps(calls) {
  return {
    buildImages: () => {
      calls.push("build");
      return "sha256:new";
    },
    saveState: (state) => calls.push(`save ${state.image_id}`),
    stopDaemon: async () => calls.push("stop"),
    startDaemon: async () => calls.push("start"),
  };
}

test("e2e-restart at the container placement rebuilds before the daemon starts", async () => {
  const calls = [];
  const state = { placement: "container", image_id: "sha256:old" };
  await restartServerManaged(state, restartSteps(calls));
  assert.deepEqual(calls, ["build", "save sha256:new", "stop", "start"]);
  assert.equal(state.image_id, "sha256:new");
});

test("e2e-restart at the server placement builds no image", async () => {
  const calls = [];
  const state = { placement: "server" };
  await restartServerManaged(state, restartSteps(calls));
  assert.deepEqual(calls, ["stop", "start"]);
  assert.equal("image_id" in state, false);
});

test("e2e-restart refuses the worker placement", async () => {
  await assert.rejects(
    restartServerManaged({ placement: "worker" }, restartSteps([])),
    /no daemon pool/,
  );
});

test("a failed build stops e2e-restart before the daemon stops", async () => {
  const calls = [];
  const steps = {
    ...restartSteps(calls),
    buildImages: () => {
      throw new Error("build failed");
    },
  };
  await assert.rejects(
    restartServerManaged({ placement: "container" }, steps),
    /build failed/,
  );
  assert.deepEqual(calls, []);
});

test("containerRuntime reads CONTAINER_ENGINE, then probes podman and docker", () => {
  assert.equal(containerRuntime({ CONTAINER_ENGINE: "docker" }), "docker");
  const onlyDocker = (runtime) => {
    if (runtime !== "docker") throw new Error("absent");
  };
  assert.equal(containerRuntime({}, onlyDocker), "docker");
  assert.equal(
    containerRuntime({}, () => {}),
    "podman",
  );
  assert.throws(
    () =>
      containerRuntime({}, () => {
        throw new Error("absent");
      }),
    /neither podman nor docker/,
  );
});

test("ownedContainers lists the names that carry the owner label", () => {
  const calls = [];
  const exec = (runtime, args) => {
    calls.push([runtime, ...args]);
    return "kanthord_slot_a\nkanthord_slot_b\n";
  };
  assert.deepEqual(ownedContainers("podman", exec), [
    "kanthord_slot_a",
    "kanthord_slot_b",
  ]);
  assert.deepEqual(calls[0].slice(0, 5), [
    "podman",
    "ps",
    "--all",
    "--filter",
    "label=io.kanthord.owner",
  ]);
});

test("the daemon stop waits until no owned container remains", async () => {
  const answers = ["kanthord_slot_a\n", "kanthord_slot_a\n", ""];
  await requireNoOwnedContainers("podman", {
    exec: () => answers.shift() ?? "",
    pause: async () => {},
  });
  assert.equal(answers.length, 0);
});

test("the daemon stop fails when an owned container remains", async () => {
  await assert.rejects(
    requireNoOwnedContainers("podman", {
      exec: () => "kanthord_slot_a\n",
      waitMs: 1000,
      pause: async () => {},
    }),
    /kanthord_slot_a/,
  );
});
