export async function unsuitableEnablementCredentials(api, enablements) {
  const refusals = [];
  for (const [agent, enablement] of Object.entries(enablements))
    for (const { credential, provider } of enablement.providers) {
      const found = await api.get(`/api/llm/credential/${credential}`);
      if (!found)
        refusals.push(`${agent}: credential ${credential} is missing`);
      else if (found.platform !== provider)
        refusals.push(
          `${agent}: credential ${credential} has the platform ${found.platform}, not ${provider}`,
        );
    }
  return refusals;
}

export function requireEnablementCredentials(refusals) {
  if (refusals.length === 0) return;
  throw new Error(
    `${refusals.join("; ")}. Create each credential before the run, for example with \`kanthord llm credential login <platform> --name <credential>\``,
  );
}
