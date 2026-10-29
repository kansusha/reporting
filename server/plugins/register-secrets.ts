import { defineNitroPlugin } from "@agent-native/core/server";
import { registerRequiredSecret } from "@agent-native/core/secrets";

// Jira Cloud auth for this app: a personal API token, not OAuth — see
// server/lib/jira.ts for why (Jira Software's Agile API needs granular OAuth
// scopes the shared workspace-connection route can't request).
export default defineNitroPlugin(() => {
  registerRequiredSecret({
    key: "JIRA_BASE_URL",
    label: "Jira site URL",
    description: "Your Jira Cloud site, e.g. https://yourteam.atlassian.net",
    scope: "user",
    kind: "api-key",
    required: true,
    usedFor: [
      {
        feature: "Sprint reporting",
        effectWhenRemoved: "Sprint sync and reports stop working.",
      },
    ],
    validator: async (value) => {
      const trimmed = value.trim();
      if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/i.test(trimmed)) {
        return {
          ok: false,
          error:
            "Enter your Jira Cloud site URL, e.g. https://yourteam.atlassian.net",
        };
      }
      return { ok: true };
    },
  });

  registerRequiredSecret({
    key: "JIRA_USER_EMAIL",
    label: "Jira account email",
    description: "The Atlassian account email that owns the API token below.",
    scope: "user",
    kind: "api-key",
    required: true,
    validator: async (value) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        return { ok: false, error: "Enter a valid email address." };
      }
      return { ok: true };
    },
  });

  registerRequiredSecret({
    key: "JIRA_API_TOKEN",
    label: "Jira API token",
    description: "Create one at id.atlassian.com/manage-profile/security/api-tokens.",
    docsUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    scope: "user",
    kind: "api-key",
    required: true,
    usedFor: [
      {
        feature: "Sprint reporting",
        effectWhenRemoved: "Sprint sync and reports stop working.",
      },
    ],
  });
});
