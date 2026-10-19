/* Sign-in, first-run setup and two-factor. The password never leaves this page:
   it is stretched with PBKDF2-SHA256 (600k rounds) here, and only the result is sent. */
"use strict";
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const theme = (() => { try { return localStorage.getItem("vt_theme"); } catch (e) { return null; } })();
  if (theme) document.documentElement.dataset.theme = theme;

  async function derive(password, saltHex, iterations) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
  }
  window.VantageAuth = { derive };

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { credentials: "same-origin" } : {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Vantage": "1" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    return d;
  }
  function problems(pw, user) {
    const p = [];
    if (pw.length < 12) p.push("Use at least 12 characters.");
    if (user && pw.toLowerCase().includes(user.toLowerCase())) p.push("Don't include your username.");
    const cls = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(pw)).length;
    if (pw.length < 16 && cls < 3) p.push("Mix upper/lower case, digits and symbols, or use a 16+ character passphrase.");
    return p;
  }

  function screen(mode) {
    const title = mode === "setup" ? "Claim your Vantage" : mode === "mfa" ? "Two-step check" : "Vantage";
    const tag = mode === "setup" ? "One-time setup. Enter the setup code you were given, then choose your credentials."
      : mode === "mfa" ? "Enter the 6-digit code from your authenticator, or a recovery code." : "Private command center. Authorised access only.";
    $("#root").innerHTML = `<div class="auth"><div class="tapeline"></div><div class="auth-card">
      <div class="logo"><div class="mk"></div><div><div class="w">VANTAGE</div><div class="s">PERSONAL TERMINAL</div></div></div>
      <h1>${esc(title)}</h1><div class="tag">${esc(tag)}</div>
      <form id="f" class="form" autocomplete="on">
        ${mode === "setup" ? `<label class="f"><span>Setup code</span><input class="in mono" name="code" autocapitalize="characters" spellcheck="false" required></label>` : ""}
        ${mode !== "mfa" ? `<label class="f"><span>Username</span><input class="in" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
          <label class="f"><span>Password</span><input class="in" name="password" type="password" autocomplete="${mode === "setup" ? "new-password" : "current-password"}" required></label>` :
          `<label class="f"><span>Code</span><input class="in mono" name="code" inputmode="numeric" autocomplete="one-time-code" required style="font-size:20px;letter-spacing:.3em;text-align:center"></label>`}
        ${mode === "setup" ? `<label class="f"><span>Repeat password</span><input class="in" name="password2" type="password" autocomplete="new-password" required></label>
          <div class="strength"><b id="stb" style="width:0"></b></div><div class="help">12+ characters with mixed types, or a 16+ character passphrase.</div>` : ""}
        ${mode === "login" ? `<label class="row small muted"><input type="checkbox" name="remember"> Keep me signed in on this device for 30 days</label>` : ""}
        <div class="err-msg" id="err"></div>
        <button class="btn pri" type="submit" id="go" style="justify-content:center;padding:10px">${mode === "setup" ? "Create account" : mode === "mfa" ? "Verify" : "Sign in"}</button>
      </form>
      <div class="foot">PBKDF2 · 600K ROUNDS IN-BROWSER · RATE-LIMITED${mode === "mfa" ? " · TOTP" : ""}</div></div></div>`;
    const f = $("#f");
    const pw = f.querySelector("[name=password]");
    if (mode === "setup" && pw) pw.oninput = () => {
      const v = pw.value, cls = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(v)).length;
      const sc = Math.min(1, Math.min(1, v.length / 20) * 0.7 + cls * 0.08);
      $("#stb").style.width = sc * 100 + "%";
      $("#stb").style.background = sc < 0.5 ? "var(--down)" : sc < 0.75 ? "var(--warn)" : "var(--up)";
    };
    setTimeout(() => { const i = f.querySelector("input"); if (i) i.focus(); }, 30);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      const btn = $("#go"); $("#err").textContent = ""; btn.disabled = true;
      const busy = (t) => (btn.innerHTML = `<span class="spin"></span> ${t}`);
      try {
        if (mode === "mfa") { busy("Verifying"); await api("/api/mfa", { code: d.code }); return (location.href = "/"); }
        const user = (d.username || "").trim().toLowerCase();
        if (mode === "setup") {
          const p = problems(d.password, user);
          if (p.length) throw new Error(p.join(" "));
          if (d.password !== d.password2) throw new Error("Passwords don't match.");
          busy("Securing");
          const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
          await api("/api/setup", { code: d.code.trim().toUpperCase(), username: user, salt, iterations: 600000, verifier: await derive(d.password, salt, 600000) });
        }
        busy("Signing in");
        const s = await api("/api/salt?u=" + encodeURIComponent(user));
        const r = await api("/api/login", { username: user, verifier: await derive(d.password, s.salt, s.iterations), remember: !!d.remember });
        if (r.mfa) return screen("mfa");
        location.href = "/";
      } catch (err) {
        $("#err").textContent = err.message;
        btn.disabled = false; btn.textContent = mode === "setup" ? "Create account" : mode === "mfa" ? "Verify" : "Sign in";
      }
    };
  }

  (async function boot() {
    let st;
    try { st = await api("/api/state"); } catch (e) { $("#root").innerHTML = `<div class="empty"><b>Can't reach Vantage</b>${esc(e.message)}</div>`; return; }
    if (st.authed) return (location.href = "/");
    screen(st.setup_needed ? "setup" : st.mfa_pending ? "mfa" : "login");
  })();
})();
