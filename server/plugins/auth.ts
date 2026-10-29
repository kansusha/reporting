import { createAuthPlugin, type AuthOptions } from "@agent-native/core/server";
import { signInJourneyInlineScript } from "@agent-native/core/shared";

type BetterAuthPlugin = NonNullable<
  NonNullable<AuthOptions["betterAuth"]>["plugins"]
>[number];

// Signup runs in a DB transaction; auto sign-in creates the session inside it, and
// the session hook then waits on the same 1-connection serverless pool → deadlock.
// The login page signs in with a separate /login call instead.
const signupWithoutSession: BetterAuthPlugin = {
  id: "sprintline-signup-without-session",
  init: () => ({
    options: { emailAndPassword: { enabled: true, autoSignIn: false } },
  }),
};

const loginHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in — Sprintline</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
    />
    <style>
      :root {
        --background: 150 16% 97%;
        --foreground: 160 15% 13%;
        --card: 0 0% 100%;
        --card-foreground: 160 15% 13%;
        --primary: 159 53% 30%;
        --primary-foreground: 0 0% 100%;
        --muted: 150 14% 93%;
        --muted-foreground: 156 7% 43%;
        --accent: 151 23% 91%;
        --accent-foreground: 159 53% 25%;
        --destructive: 0 70% 48%;
        --destructive-soft: 0 70% 96%;
        --border: 150 11% 87%;
        --input: 150 11% 87%;
        --ring: 159 53% 30%;
        --radius: 0.45rem;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: 160 9% 9%;
          --foreground: 150 12% 91%;
          --card: 160 8% 13%;
          --card-foreground: 150 12% 91%;
          --primary: 155 44% 56%;
          --primary-foreground: 160 20% 9%;
          --muted: 160 8% 17%;
          --muted-foreground: 154 7% 62%;
          --accent: 157 14% 19%;
          --accent-foreground: 152 42% 74%;
          --destructive: 0 68% 62%;
          --destructive-soft: 0 30% 16%;
          --border: 160 8% 23%;
          --input: 160 8% 23%;
          --ring: 155 44% 56%;
        }
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        min-height: 100%;
      }
      body {
        display: grid;
        place-items: center;
        padding: 24px;
        background: hsl(var(--background));
        background-image:
          radial-gradient(
            600px circle at 15% -10%,
            hsl(var(--primary) / 0.08),
            transparent 60%
          ),
          radial-gradient(
            500px circle at 90% 110%,
            hsl(var(--primary) / 0.06),
            transparent 55%
          );
        color: hsl(var(--foreground));
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
        font-feature-settings: "cv02", "cv03", "cv04", "cv11";
        -webkit-font-smoothing: antialiased;
      }
      .shell {
        width: 100%;
        max-width: 400px;
      }
      .brand {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 24px;
      }
      .brand-mark {
        display: flex;
        width: 32px;
        height: 32px;
        flex-direction: column;
        justify-content: center;
        gap: 3px;
        border-radius: 8px;
        background: hsl(var(--primary));
        padding: 7px;
      }
      .brand-mark span {
        display: block;
        height: 2px;
        border-radius: 999px;
        background: hsl(var(--primary-foreground));
      }
      .brand-mark span:nth-child(2) {
        width: 72%;
      }
      .brand-mark span:nth-child(3) {
        width: 46%;
      }
      .brand-name {
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.03em;
      }
      .card {
        border: 1px solid hsl(var(--border));
        border-radius: calc(var(--radius) + 4px);
        background: hsl(var(--card));
        padding: 28px;
        box-shadow:
          0 1px 2px hsl(var(--foreground) / 0.04),
          0 10px 30px -12px hsl(var(--foreground) / 0.08);
      }
      .heading {
        margin: 0 0 4px;
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .subheading {
        margin: 0 0 22px;
        color: hsl(var(--muted-foreground));
        font-size: 13px;
      }
      .tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        margin-bottom: 22px;
        padding: 4px;
        border-radius: calc(var(--radius) + 2px);
        background: hsl(var(--muted));
      }
      .tab {
        appearance: none;
        border: 0;
        background: transparent;
        padding: 7px 10px;
        border-radius: var(--radius);
        color: hsl(var(--muted-foreground));
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition:
          background-color 140ms ease-out,
          color 140ms ease-out,
          box-shadow 140ms ease-out;
      }
      .tab[aria-selected="true"] {
        background: hsl(var(--card));
        color: hsl(var(--foreground));
        box-shadow: 0 1px 2px hsl(var(--foreground) / 0.08);
      }
      .tab:focus-visible {
        outline: 2px solid hsl(var(--ring));
        outline-offset: 2px;
      }
      .field {
        margin-bottom: 14px;
      }
      .field label {
        display: block;
        margin-bottom: 6px;
        color: hsl(var(--foreground));
        font-size: 12px;
        font-weight: 500;
      }
      .field input {
        width: 100%;
        min-height: 38px;
        padding: 8px 11px;
        border: 1px solid hsl(var(--input));
        border-radius: var(--radius);
        background: hsl(var(--card));
        color: hsl(var(--foreground));
        font: inherit;
        font-size: 13px;
        transition:
          border-color 140ms ease-out,
          box-shadow 140ms ease-out;
      }
      .field input::placeholder {
        color: hsl(var(--muted-foreground) / 0.75);
      }
      .field input:focus {
        outline: none;
        border-color: hsl(var(--ring));
        box-shadow: 0 0 0 3px hsl(var(--ring) / 0.18);
      }
      .submit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        min-height: 40px;
        margin-top: 6px;
        padding: 0 14px;
        border: 1px solid hsl(var(--primary));
        border-radius: calc(var(--radius) + 1px);
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background-color 140ms ease-out,
          opacity 140ms ease-out;
      }
      .submit:hover:not(:disabled) {
        background: hsl(var(--primary) / 0.92);
      }
      .submit:focus-visible {
        outline: 2px solid hsl(var(--ring));
        outline-offset: 2px;
      }
      .submit:disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
      .spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid hsl(var(--primary-foreground) / 0.35);
        border-top-color: hsl(var(--primary-foreground));
        animation: spin 650ms linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .alert {
        display: none;
        margin-bottom: 14px;
        padding: 10px 12px;
        border: 1px solid hsl(var(--destructive) / 0.4);
        border-radius: var(--radius);
        background: hsl(var(--destructive-soft));
        color: hsl(var(--destructive));
        font-size: 12px;
        line-height: 1.5;
      }
      .alert[data-visible="true"] {
        display: block;
      }
      .footer {
        margin-top: 18px;
        text-align: center;
        color: hsl(var(--muted-foreground));
        font-size: 12px;
      }
      .footer a {
        color: hsl(var(--accent-foreground));
        text-decoration: none;
        font-weight: 500;
      }
      .footer a:hover {
        text-decoration: underline;
      }
      .hint {
        margin-top: 8px;
        color: hsl(var(--muted-foreground));
        font-size: 11px;
      }
      [hidden] {
        display: none !important;
      }
      @media (max-width: 400px) {
        .card {
          padding: 22px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span class="brand-name">Sprintline</span>
      </div>
      <section class="card" aria-labelledby="auth-heading">
        <h1 id="auth-heading" class="heading" data-slot="heading">
          Welcome back
        </h1>
        <p class="subheading" data-slot="subheading">
          Sign in to pick up your sprint reports.
        </p>

        <div class="tabs" role="tablist" aria-label="Account">
          <button
            type="button"
            class="tab"
            role="tab"
            id="tab-signin"
            aria-controls="form-signin"
            aria-selected="true"
            data-mode="signin"
          >
            Sign in
          </button>
          <button
            type="button"
            class="tab"
            role="tab"
            id="tab-signup"
            aria-controls="form-signup"
            aria-selected="false"
            data-mode="signup"
          >
            Create account
          </button>
        </div>

        <div
          class="alert"
          role="alert"
          aria-live="polite"
          data-slot="alert"
        ></div>

        <form
          id="form-signin"
          role="tabpanel"
          aria-labelledby="tab-signin"
          data-mode="signin"
          novalidate
        >
          <div class="field">
            <label for="signin-email">Email</label>
            <input
              id="signin-email"
              name="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            />
          </div>
          <div class="field">
            <label for="signin-password">Password</label>
            <input
              id="signin-password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
              placeholder="••••••••"
            />
          </div>
          <button type="submit" class="submit" data-slot="submit-signin">
            <span data-slot="submit-label-signin">Sign in</span>
          </button>
        </form>

        <form
          id="form-signup"
          role="tabpanel"
          aria-labelledby="tab-signup"
          data-mode="signup"
          hidden
          novalidate
        >
          <div class="field">
            <label for="signup-email">Email</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            />
          </div>
          <div class="field">
            <label for="signup-password">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
              placeholder="At least 8 characters"
            />
          </div>
          <div class="field">
            <label for="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              name="confirm"
              type="password"
              autocomplete="new-password"
              required
              placeholder="Re-enter password"
            />
          </div>
          <button type="submit" class="submit" data-slot="submit-signup">
            <span data-slot="submit-label-signup">Create account</span>
          </button>
          <p class="hint">
            By creating an account you agree to let Sprintline store your sprint
            report data.
          </p>
        </form>
      </section>
      <p class="footer" data-slot="footer">
        New here?
        <a href="#" data-slot="switch-link" data-target="signup">Create an account</a>
      </p>
    </main>

    <script>${signInJourneyInlineScript()}</script>
    <script>
      (function () {
        var journey = window.__anCreateSignInJourney("", "/");
        var resumeHref = journey.journeyForLocation(window.location).resumeHref;

        var tabs = document.querySelectorAll(".tab");
        var forms = {
          signin: document.getElementById("form-signin"),
          signup: document.getElementById("form-signup"),
        };
        var heading = document.querySelector('[data-slot="heading"]');
        var subheading = document.querySelector('[data-slot="subheading"]');
        var alertEl = document.querySelector('[data-slot="alert"]');
        var footer = document.querySelector('[data-slot="footer"]');
        var switchLink = document.querySelector('[data-slot="switch-link"]');

        var copy = {
          signin: {
            heading: "Welcome back",
            subheading: "Sign in to pick up your sprint reports.",
            footer: "New here?",
            switchLabel: "Create an account",
            switchTarget: "signup",
          },
          signup: {
            heading: "Create your account",
            subheading: "Start tracking sprints and story points in minutes.",
            footer: "Already have an account?",
            switchLabel: "Sign in",
            switchTarget: "signin",
          },
        };

        function clearAlert() {
          alertEl.removeAttribute("data-visible");
          alertEl.textContent = "";
        }

        function showAlert(message) {
          alertEl.textContent = message;
          alertEl.setAttribute("data-visible", "true");
        }

        function setMode(mode) {
          tabs.forEach(function (tab) {
            var isActive = tab.getAttribute("data-mode") === mode;
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
          });
          Object.keys(forms).forEach(function (key) {
            if (key === mode) {
              forms[key].removeAttribute("hidden");
            } else {
              forms[key].setAttribute("hidden", "");
            }
          });
          heading.textContent = copy[mode].heading;
          subheading.textContent = copy[mode].subheading;
          footer.firstChild.nodeValue = copy[mode].footer + " ";
          switchLink.textContent = copy[mode].switchLabel;
          switchLink.setAttribute("data-target", copy[mode].switchTarget);
          clearAlert();
          var firstInput = forms[mode].querySelector("input");
          if (firstInput) firstInput.focus();
        }

        tabs.forEach(function (tab) {
          tab.addEventListener("click", function () {
            setMode(tab.getAttribute("data-mode"));
          });
        });
        switchLink.addEventListener("click", function (event) {
          event.preventDefault();
          setMode(switchLink.getAttribute("data-target"));
        });

        function setLoading(form, loading) {
          var button = form.querySelector(".submit");
          var inputs = form.querySelectorAll("input");
          button.disabled = loading;
          inputs.forEach(function (input) {
            input.disabled = loading;
          });
          var slot = form === forms.signin ? "signin" : "signup";
          var label = button.querySelector(
            '[data-slot="submit-label-' + slot + '"]',
          );
          if (loading) {
            if (!button.querySelector(".spinner")) {
              var spinner = document.createElement("span");
              spinner.className = "spinner";
              spinner.setAttribute("aria-hidden", "true");
              button.insertBefore(spinner, label);
            }
            label.textContent =
              slot === "signin" ? "Signing in…" : "Creating account…";
          } else {
            var existing = button.querySelector(".spinner");
            if (existing) existing.remove();
            label.textContent = slot === "signin" ? "Sign in" : "Create account";
          }
        }

        function postJson(path, body) {
          return fetch(path, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
            .then(function (res) {
              return res
                .json()
                .catch(function () {
                  return { error: "Unexpected response from server." };
                })
                .then(function (data) {
                  return { status: res.status, data: data };
                });
            })
            .catch(function () {
              return {
                status: 0,
                data: {
                  error: "Can't reach the server. Check your connection.",
                },
              };
            });
        }

        function errorFrom(result, fallback) {
          var data = result && result.data;
          if (data && typeof data.error === "string" && data.error) {
            return data.error;
          }
          return fallback;
        }

        forms.signin.addEventListener("submit", function (event) {
          event.preventDefault();
          clearAlert();
          var email = forms.signin.email.value.trim();
          var password = forms.signin.password.value;
          if (!email || !password) {
            showAlert("Enter your email and password.");
            return;
          }
          setLoading(forms.signin, true);
          postJson("/_agent-native/auth/login", {
            email: email,
            password: password,
          }).then(function (result) {
            if (result.data && result.data.ok) {
              window.location.replace(resumeHref);
              return;
            }
            setLoading(forms.signin, false);
            showAlert(
              errorFrom(
                result,
                "That email and password didn't match. Try again.",
              ),
            );
          });
        });

        forms.signup.addEventListener("submit", function (event) {
          event.preventDefault();
          clearAlert();
          var email = forms.signup.email.value.trim();
          var password = forms.signup.password.value;
          var confirm = forms.signup.confirm.value;
          if (!email || !password) {
            showAlert("Enter an email and password to continue.");
            return;
          }
          if (password.length < 8) {
            showAlert("Password must be at least 8 characters.");
            return;
          }
          if (password !== confirm) {
            showAlert("Passwords don't match.");
            return;
          }
          setLoading(forms.signup, true);
          postJson("/_agent-native/auth/register", {
            email: email,
            password: password,
          }).then(function (result) {
            if (!(result.data && result.data.ok)) {
              setLoading(forms.signup, false);
              showAlert(
                errorFrom(
                  result,
                  "We couldn't create your account. Try a different email.",
                ),
              );
              return;
            }
            postJson("/_agent-native/auth/login", {
              email: email,
              password: password,
            }).then(function (loginResult) {
              if (loginResult.data && loginResult.data.ok) {
                window.location.replace(resumeHref);
                return;
              }
              setLoading(forms.signup, false);
              showAlert(
                "We couldn't sign you in. If you already have an account with this email, use Sign in.",
              );
            });
          });
        });

        var initialInput = forms.signin.querySelector("input");
        if (initialInput) initialInput.focus();
      })();
    </script>
  </body>
</html>`;

export default createAuthPlugin({
  rootAuth: false, // auth is not serverd on / by default
  workspaceAppPublicPaths: ["/debug-auth"],
  loginHtml,
  betterAuth: { plugins: [signupWithoutSession] },
});
