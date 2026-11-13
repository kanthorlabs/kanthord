const { readdirSync } = require("node:fs");

for (const name of readdirSync(__dirname)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort())
  import(`./${name}`);
