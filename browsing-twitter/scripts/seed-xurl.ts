// Seed xurl's token store with the OAuth 2.0 user tokens Michael generated in the X console,
// so no browser login is needed. Reads X_OA2_* from the environment, prints no secrets.
// expiration_time 0 marks the access token expired: the next `xurl token` refreshes it and
// saves the rotated refresh token.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const path = join(homedir(), ".xurl", "auth.yml");
const access = process.env.X_OA2_ACCESS_TOKEN;
const refresh = process.env.X_OA2_REFRESH_TOKEN;
if (!access || !refresh) throw new Error("X_OA2_ACCESS_TOKEN / X_OA2_REFRESH_TOKEN not set");

type Store = {
  apps: Record<string, Record<string, unknown>>;
  default_app: string;
};
const store = Bun.YAML.parse(readFileSync(path, "utf8")) as Store;
const app = store.apps.kiliman;
if (!app) throw new Error("app kiliman is not registered in xurl");

app.oauth2_tokens = {
  kiliman: {
    type: "oauth2",
    oauth2: { access_token: access, refresh_token: refresh, expiration_time: 0 },
  },
};
app.default_user = "kiliman";
delete store.apps.default; // empty placeholder xurl created on first run

// JSON is valid YAML; xurl rewrites the file in YAML on its next save.
writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 });
console.log("seeded oauth2 token for kiliman; apps:", Object.keys(store.apps).join(", "));
