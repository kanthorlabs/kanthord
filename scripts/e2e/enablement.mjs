const OAUTH_SECRET_SHAPE = "oauth";

export function mergedProviders(current, enablement) {
  const providers = [...(current?.agent_providers ?? [])];
  for (const provider of enablement.providers)
    if (!providers.some((item) => item.name === provider.name))
      providers.push(provider);
  return providers;
}

function refusalOf(
  agent,
  { provider, credential },
  found,
  secretShapes,
  configPath,
) {
  if (!found) {
    const nextStep =
      secretShapes.get(provider) === OAUTH_SECRET_SHAPE
        ? `run \`kanthord llm credential login ${provider} --name ${credential}\``
        : `add it to credentials in ${configPath}`;
    return `${agent}: credential ${credential} is missing; ${nextStep}`;
  }
  if (found.platform !== provider)
    return `${agent}: credential ${credential} serves the provider ${found.platform}, not ${provider}; archive it or choose another credential name`;
  if (!found.revisions.some((revision) => revision.ended_at === null))
    return `${agent}: credential ${credential} has no live revision; archive it or choose another credential name`;
  return null;
}

export async function unsuitableEnablementCredentials(
  api,
  enablements,
  configPath,
) {
  const platforms = await api.get("/api/llm/credential/platform");
  const secretShapes = new Map(
    platforms.items.map((item) => [item.platform, item.secret_shape]),
  );
  const refusals = [];
  for (const [agent, enablement] of Object.entries(enablements)) {
    const current = await api.get(`/api/agent/enablement/${agent}`);
    for (const item of mergedProviders(current, enablement)) {
      const found = await api.get(`/api/llm/credential/${item.credential}`);
      const refusal = refusalOf(agent, item, found, secretShapes, configPath);
      if (refusal) refusals.push(refusal);
    }
  }
  return refusals;
}

export function requireEnablementCredentials(refusals) {
  if (refusals.length > 0) throw new Error(refusals.join("\n"));
}
