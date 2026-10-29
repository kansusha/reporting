import { defineEventHandler } from "h3";
import { getDbExec } from "@agent-native/core/db";
import { createBetterAuthSessionForEmail, getBetterAuth } from "../../node_modules/@agent-native/core/dist/server/better-auth-instance.js";
import {
  setFrameworkSessionCookie,
  setFirstRunOnboardingCookie,
  addSession,
  isLocalDevAuthAllowed
} from "../../node_modules/@agent-native/core/dist/server/auth.js";
import { clearIdentityGoogleAuthCookie } from "../../node_modules/@agent-native/core/dist/server/identity-auth-provider.js";

export default defineEventHandler(async (event) => {
  const stepResults: Record<string, any> = {};
  try {
    stepResults.isLocalDevAuthAllowed = isLocalDevAuthAllowed(event);

    const auth = await getBetterAuth();
    stepResults.authOk = true;

    const session = await createBetterAuthSessionForEmail("dev@local.test");
    stepResults.session = session;

    if (!session) {
      stepResults.error = "no session";
      return stepResults;
    }

    try {
      setFrameworkSessionCookie(event, session.token);
      stepResults.setFrameworkSessionCookie = "ok";
    } catch (e: any) {
      stepResults.setFrameworkSessionCookieError = String(e?.stack || e);
    }

    try {
      clearIdentityGoogleAuthCookie(event);
      stepResults.clearIdentityGoogleAuthCookie = "ok";
    } catch (e: any) {
      stepResults.clearIdentityGoogleAuthCookieError = String(e?.stack || e);
    }

    try {
      setFirstRunOnboardingCookie(event);
      stepResults.setFirstRunOnboardingCookie = "ok";
    } catch (e: any) {
      stepResults.setFirstRunOnboardingCookieError = String(e?.stack || e);
    }

    try {
      await addSession(session.token, session.email);
      stepResults.addSession = "ok";
    } catch (e: any) {
      stepResults.addSessionError = String(e?.stack || e);
    }

  } catch (err: any) {
    stepResults.topLevelError = String(err?.stack || err);
  }
  return stepResults;
});
