import { defineEventHandler, getMethod, setResponseStatus } from "h3";
import { getDbExec } from "@agent-native/core/db";
import {
  createBetterAuthSessionForEmail,
  getBetterAuth
} from "../../node_modules/@agent-native/core/dist/server/better-auth-instance.js";
import {
  setFrameworkSessionCookie,
  setFirstRunOnboardingCookie,
  addSession,
  isLocalDevAuthAllowed
} from "../../node_modules/@agent-native/core/dist/server/auth.js";
import { clearIdentityGoogleAuthCookie } from "../../node_modules/@agent-native/core/dist/server/identity-auth-provider.js";

export default defineEventHandler(async (event) => {
  const log: any[] = [];
  try {
    log.push({ step: "start", method: getMethod(event) });
    const isAllowed = isLocalDevAuthAllowed(event);
    log.push({ step: "isLocalDevAuthAllowed", isAllowed });

    let auth: any;
    try {
      auth = await getBetterAuth();
      log.push({ step: "getBetterAuth", ok: true });
    } catch (e: any) {
      log.push({ step: "getBetterAuth", error: String(e?.stack || e) });
      throw e;
    }

    let session: any;
    try {
      session = await createBetterAuthSessionForEmail("dev@local.test");
      log.push({ step: "createBetterAuthSessionForEmail", session });
    } catch (e: any) {
      log.push({ step: "createBetterAuthSessionForEmail", error: String(e?.stack || e) });
      throw e;
    }

    if (!session) {
      log.push({ step: "session_null" });
      return { ok: false, log };
    }

    try {
      setFrameworkSessionCookie(event, session.token);
      log.push({ step: "setFrameworkSessionCookie", ok: true });
    } catch (e: any) {
      log.push({ step: "setFrameworkSessionCookie", error: String(e?.stack || e) });
      throw e;
    }

    try {
      clearIdentityGoogleAuthCookie(event);
      log.push({ step: "clearIdentityGoogleAuthCookie", ok: true });
    } catch (e: any) {
      log.push({ step: "clearIdentityGoogleAuthCookie", error: String(e?.stack || e) });
      throw e;
    }

    try {
      setFirstRunOnboardingCookie(event);
      log.push({ step: "setFirstRunOnboardingCookie", ok: true });
    } catch (e: any) {
      log.push({ step: "setFirstRunOnboardingCookie", error: String(e?.stack || e) });
      throw e;
    }

    try {
      await addSession(session.token, session.email);
      log.push({ step: "addSession", ok: true });
    } catch (e: any) {
      log.push({ step: "addSession", error: String(e?.stack || e) });
      throw e;
    }

    log.push({ step: "complete", ok: true });
    return { ok: true, log };
  } catch (err: any) {
    return { ok: false, error: String(err?.stack || err), log };
  }
});
