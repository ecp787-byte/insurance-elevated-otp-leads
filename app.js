(function () {
  const LEADS_PER_PACK = 25;
  const MIN_STATES = 10;
  const RATES = { standard: 50, partner: 40 };
  const STATES = [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
    ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
    ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
    ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
    ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
    ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
    ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
    ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
    ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
    ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
    ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
    ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
    ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ];

  const state = {
    standard: 1,
    partner: 1,
    partnerCode: null,
    selectedStates: { standard: new Set(), partner: new Set() },
  };

  let modalTarget = null;
  let modalDraft = new Set();

  function fmt(n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderTier(tier) {
    const packs = state[tier];
    document.getElementById(`qty-${tier}`).value = packs;
    document.getElementById(`leads-${tier}`).textContent = `= ${packs * LEADS_PER_PACK} leads`;
    document.getElementById(`total-${tier}`).textContent = fmt(packs * LEADS_PER_PACK * RATES[tier]);
  }

  function renderStatesButton(tier) {
    const count = state.selectedStates[tier].size;
    const btn = document.getElementById(`states-btn-${tier}`);
    btn.textContent = count === 0 ? "Select States — 0 chosen" : `${count} state${count === 1 ? "" : "s"} selected — Edit`;
    btn.classList.toggle("ok", count >= MIN_STATES);
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
  renderStatesButton("standard");
  renderStatesButton("partner");

  function setMsg(id, text, kind) {
    const el = document.getElementById(id);
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  // ---------- States modal ----------
  const grid = document.getElementById("states-grid");
  STATES.forEach(([code, name]) => {
    const label = document.createElement("label");
    label.className = "state-pill";
    label.innerHTML = `<input type="checkbox" value="${code}" /><span>${name}</span>`;
    label.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) modalDraft.add(code);
      else modalDraft.delete(code);
      updateModalCount();
    });
    grid.appendChild(label);
  });

  function updateModalCount() {
    document.getElementById("states-count").textContent = modalDraft.size;
    const confirmBtn = document.getElementById("states-confirm");
    confirmBtn.disabled = modalDraft.size < MIN_STATES;
    confirmBtn.textContent =
      modalDraft.size < MIN_STATES
        ? `Select ${MIN_STATES - modalDraft.size} more to continue`
        : "Confirm Selection";
    setMsg("msg-states", "", "");
  }

  function openStatesModal(tier) {
    modalTarget = tier;
    modalDraft = new Set(state.selectedStates[tier]);
    grid.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = modalDraft.has(cb.value);
    });
    updateModalCount();
    document.getElementById("states-modal").hidden = false;
  }

  function closeStatesModal() {
    document.getElementById("states-modal").hidden = true;
    modalTarget = null;
  }

  document.querySelectorAll(".states-select-btn").forEach((btn) => {
    btn.addEventListener("click", () => openStatesModal(btn.dataset.target));
  });

  document.getElementById("states-modal-close").addEventListener("click", closeStatesModal);
  document.getElementById("states-modal").addEventListener("click", (e) => {
    if (e.target.id === "states-modal") closeStatesModal();
  });

  document.getElementById("states-select-all").addEventListener("click", () => {
    modalDraft = new Set(STATES.map(([code]) => code));
    grid.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = true));
    updateModalCount();
  });

  document.getElementById("states-clear").addEventListener("click", () => {
    modalDraft.clear();
    grid.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
    updateModalCount();
  });

  document.getElementById("states-confirm").addEventListener("click", () => {
    if (modalDraft.size < MIN_STATES) return;
    state.selectedStates[modalTarget] = new Set(modalDraft);
    renderStatesButton(modalTarget);
    closeStatesModal();
  });

  // ---------- Checkout ----------
  async function startCheckout(tier, button) {
    const msgId = tier === "standard" ? "msg-standard" : "msg-partner";
    const chosen = state.selectedStates[tier];
    if (chosen.size < MIN_STATES) {
      setMsg(msgId, `Select at least ${MIN_STATES} target states before checking out.`, "err");
      openStatesModal(tier);
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Redirecting to checkout…";
    setMsg(msgId, "", "");
    try {
      const body = { tier, packs: state[tier], states: Array.from(chosen) };
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

  // ---------- Scroll-reveal + counters ----------
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const revealEls = Array.from(document.querySelectorAll("[data-reveal]"));
  revealEls.forEach((el) => {
    const siblings = Array.from(el.parentElement.children).filter((c) => c.hasAttribute("data-reveal"));
    const idx = siblings.indexOf(el);
    el.style.setProperty("--reveal-delay", Math.min(idx * 0.09, 0.45) + "s");
  });

  if (prefersReducedMotion) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  } else if ("IntersectionObserver" in window && revealEls.length) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  function animateCounter(el) {
    const raw = el.textContent.trim();
    const match = raw.match(/^([^\d]*)([\d,]+)([^\d]*)$/);
    if (!match) return;
    const [, prefix, numStr, suffix] = match;
    const target = parseInt(numStr.replace(/,/g, ""), 10);
    if (Number.isNaN(target)) return;
    const duration = 1100;
    const startTime = performance.now();
    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * eased);
      el.textContent = prefix + current.toLocaleString("en-US") + suffix;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = raw;
      }
    }
    requestAnimationFrame(tick);
  }

  const counterEls = Array.from(document.querySelectorAll("[data-counter]"));
  if (!prefersReducedMotion && "IntersectionObserver" in window && counterEls.length) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    counterEls.forEach((el) => counterObserver.observe(el));
  }
})();
