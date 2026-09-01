(function () {
  const LEADS_PER_PACK = 25;
  const RATES = { standard: 50, partner: 40 };
  const state = { standard: 1, partner: 1, partnerCode: null };

  function fmt(n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderTier(tier) {
    const packs = state[tier];
    document.getElementById(`qty-${tier}`).value = packs;
    document.getElementById(`leads-${tier}`).textContent = `= ${packs * LEADS_PER_PACK} leads`;
    document.getElementById(`total-${tier}`).textContent = fmt(packs * LEADS_PER_PACK * RATES[tier]);
  }

  document.querySelectorAll(".qty-control button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tier = btn.dataset.target;
      const action = btn.dataset.action;
      if (action === "inc") state[tier] = Math.min(400, state[tier] + 1);
      if (action === "dec") state[tier] = Math.max(1, state[tier] - 1);
      renderTier(tier);
    });
  });

  renderTier("standard");
  renderTier("partner");

  function setMsg(id, text, kind) {
    const el = document.getElementById(id);
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  async function startCheckout(tier, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Redirecting to checkout…";
    const msgId = tier === "standard" ? "msg-standard" : "msg-partner";
    setMsg(msgId, "", "");
    try {
      const body = { tier, packs: state[tier] };
      if (tier === "partner") body.partnerCode = state.partnerCode;
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(msgId, data.error || "Something went wrong.", "err");
        button.disabled = false;
        button.textContent = originalText;
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setMsg(msgId, "Network error — please try again.", "err");
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  document.getElementById("buy-standard").addEventListener("click", (e) => {
    startCheckout("standard", e.currentTarget);
  });
  document.getElementById("buy-partner").addEventListener("click", (e) => {
    startCheckout("partner", e.currentTarget);
  });

  document.getElementById("unlock-partner").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const code = document.getElementById("partner-code").value.trim();
    if (!code) {
      setMsg("msg-partner-gate", "Enter your partner code.", "err");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      const res = await fetch("/api/verify-partner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.ok) {
        state.partnerCode = code;
        document.getElementById("partner-locked").style.display = "none";
        document.getElementById("partner-unlocked").style.display = "block";
      } else {
        setMsg("msg-partner-gate", data.message || "Invalid code.", "err");
        btn.disabled = false;
        btn.textContent = "Unlock Partner Pricing";
      }
    } catch (err) {
      setMsg("msg-partner-gate", "Network error — please try again.", "err");
      btn.disabled = false;
      btn.textContent = "Unlock Partner Pricing";
    }
  });
})();
