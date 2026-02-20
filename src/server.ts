import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = createApp({ env });

app.listen(env.PORT, env.HOST, () => {
  console.log(`english-trainer listening on http://${env.HOST}:${env.PORT}`);
});
