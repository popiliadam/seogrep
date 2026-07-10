import { createHealthServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
createHealthServer().listen(port, () => {
  console.warn(`pseo-mcp health listening on :${port}`);
});
