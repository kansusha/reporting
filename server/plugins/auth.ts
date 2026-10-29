import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  rootAuth: false, // auth is not serverd on / by default
  workspaceAppPublicPaths: ["/debug-auth"],
});
