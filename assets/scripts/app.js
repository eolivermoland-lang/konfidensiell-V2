const navigationItems = [
  { href: "index.html", label: "Hjem", key: "home" },
  { href: "om-oss.html", label: "Om oss", key: "about" },
  { href: "portal.html", label: "Verktøy", key: "tools" },
  { href: "portal.html", label: "Portal", key: "portal" }
];

const footerLinks = [
  { href: "om-oss.html", label: "Om" },
  { href: "prosjekter.html", label: "Tjenester" },
  { href: "kontakt.html", label: "Personvern" },
  { href: "portal.html", label: "Vilkår" }
];

const modelSets = {
  dev: ["Titan Kjapp", "Titan Standard", "Titan Pro", "Titan Tenkende"],
  official: ["Beta Titan AI", "Titan Safe", "Titan Assist", "Titan Search"]
};

let titanAbortController = null;
const TITAN_STORAGE_KEY = "titan_chat_sessions_v1";

function loadTitanSessions() {
  try {
    return JSON.parse(localStorage.getItem(TITAN_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveTitanSessions(sessions) {
  localStorage.setItem(TITAN_STORAGE_KEY, JSON.stringify(sessions.slice(0, 12)));
}

function makeChatTitle(prompt) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  const preview = clean.split(" ").slice(0, 6).join(" ");
  return preview.length > 40 ? `${preview.slice(0, 40)}…` : preview;
}

function inferModelPreset(label = "") {
  const text = label.toLowerCase();
  if (text.includes("kjapp")) return "fast";
  if (text.includes("pro")) return "pro";
  if (text.includes("tenkende")) return "thinking";
  return "standard";
}

function renderConversationList(container, sessions, activeId) {
  if (!container) return;
  if (!sessions.length) {
    container.innerHTML = `<span class="conversation-chip active">Nåværende chat</span>`;
    return;
  }

  container.innerHTML = sessions
    .map(
      (session) => `
        <button class="conversation-chip ${session.id === activeId ? "active" : ""}" type="button" data-chat-id="${session.id}">
          ${session.title}
        </button>
      `
    )
    .join("");
}

function inferTitanMode(prompt) {
  const text = prompt.toLowerCase();
  if (
    text.includes("react") ||
    text.includes("tailwind") ||
    text.includes("kode") ||
    text.includes("javascript") ||
    text.includes("html") ||
    text.includes("css")
  ) {
    return "code";
  }
  if (text.includes("bio")) return "bio";
  if (text.includes("e-post") || text.includes("email")) return "email";
  if (text.includes("produkt")) return "product";
  if (text.includes("omskriv") || text.includes("forbedre denne teksten")) return "rewrite";
  if (text.includes("nettside") || text.includes("introduksjon")) return "website";
  return "default";
}

function inferFileNameFromPrompt(prompt, language = "") {
  const text = prompt.toLowerCase();
  const lang = (language || "").toLowerCase();
  if (lang === "html" || text.includes("html")) return "index.html";
  if (lang === "css" || text.includes("css")) return "styles.css";
  if (lang === "javascript" || lang === "js" || text.includes("javascript") || text.includes("js")) return "script.js";
  if (lang === "jsx" || lang === "tsx" || text.includes("react")) return "App.jsx";
  return "output.txt";
}

function languageFromFileName(name = "") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".tsx")) return "tsx";
  return "text";
}

function sanitizeCodeBlock(block = "") {
  return String(block || "")
    .replace(/\r\n/g, "\n")
    .replace(/^===FILE:[^\n=]+===\s*/i, "")
    .replace(/^```[a-zA-Z0-9_-]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseTitanFiles(reply, prompt, mode) {
  const text = String(reply || "");
  const files = [];
  const structuredPattern = /(?:^|\n)===FILE:\s*([^\n=]+?)===\s*```([a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```/g;
  let match;

  while ((match = structuredPattern.exec(text))) {
    files.push({
      name: match[1].trim(),
      language: (match[2] || languageFromFileName(match[1])).trim(),
      content: sanitizeCodeBlock(match[3])
    });
  }

  if (files.length) return files;

  const fencePattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  while ((match = fencePattern.exec(text))) {
    const language = (match[1] || "").trim();
    files.push({
      name: inferFileNameFromPrompt(prompt, language),
      language: language || languageFromFileName(inferFileNameFromPrompt(prompt, language)),
      content: sanitizeCodeBlock(match[2])
    });
  }

  if (files.length) {
    const seen = new Set();
    return files.map((file, index) => {
      let name = file.name;
      if (seen.has(name)) {
        const parts = name.split(".");
        const ext = parts.length > 1 ? `.${parts.pop()}` : "";
        name = `${parts.join(".") || "file"}-${index + 1}${ext}`;
      }
      seen.add(name);
      return { ...file, name };
    });
  }

  if (mode === "code" && /<(?:!DOCTYPE|html|div|section|script|style)/i.test(text)) {
    return [
      {
        name: inferFileNameFromPrompt(prompt, "html"),
        language: "html",
        content: sanitizeCodeBlock(text)
      }
    ];
  }

  return [];
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderCodeCanvas(shell, files) {
  const canvas = shell?.querySelector("[data-code-canvas]");
  const tabs = shell?.querySelector("[data-code-tabs]");
  const codeContent = shell?.querySelector("[data-code-content]");
  const codeMeta = shell?.querySelector("[data-code-meta]");
  const downloadButton = shell?.querySelector("[data-code-download]");
  const message = shell?.querySelector("[data-ai-response]");
  if (!canvas || !tabs || !codeContent || !codeMeta || !downloadButton || !message) return;

  if (!files.length) {
    canvas.hidden = true;
    message.hidden = false;
    tabs.innerHTML = "";
    codeContent.textContent = "";
    return;
  }

  let activeIndex = 0;
  const selectFile = (index) => {
    activeIndex = index;
    const active = files[activeIndex];
    tabs.querySelectorAll(".code-tab").forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === activeIndex);
    });
    codeContent.textContent = active.content;
    codeMeta.textContent = `${active.name} · ${active.language || "tekst"} · ${active.content.split("\n").length} linjer`;
    downloadButton.textContent = `Last ned ${active.name}`;
  };

  tabs.innerHTML = files
    .map(
      (file, index) =>
        `<button class="code-tab ${index === 0 ? "active" : ""}" type="button" data-code-tab="${index}">${file.name}</button>`
    )
    .join("");

  tabs.onclick = (event) => {
    const button = event.target.closest("[data-code-tab]");
    if (!button) return;
    selectFile(Number(button.dataset.codeTab));
  };

  downloadButton.onclick = () => {
    const active = files[activeIndex];
    downloadTextFile(active.name, active.content);
  };

  selectFile(0);
  message.hidden = true;
  canvas.hidden = false;
}

function clearCodeCanvas(shell) {
  renderCodeCanvas(shell, []);
}

function buildThinkingData(prompt, mode) {
  if (mode === "code") {
    return {
      modeLabel: "Kode",
      summary: `Titan tolker forespoerselen som en kodeoppgave: "${prompt}"`,
      suggestions: [
        "Levere kode foerst og kutte forklaring.",
        "Holde komponenten kort nok til aa bli ferdig.",
        "Bruke konkrete Tailwind-klasser og moderne JSX."
      ],
      selected: "Velger kodefoerst med mest mulig ferdig struktur."
    };
  }

  if (mode === "bio") {
    return {
      modeLabel: "Bio",
      summary: `Titan tolker forespoerselen som bioskriving: "${prompt}"`,
      suggestions: [
        "Skrive kort og profesjonelt.",
        "Beholde tydelig stemme.",
        "Unngaa HTML og kode."
      ],
      selected: "Velger en ren bio i naturlig bokmaal."
    };
  }

  if (mode === "website") {
    return {
      modeLabel: "Nettsidetekst",
      summary: `Titan tolker forespoerselen som nettsidetekst: "${prompt}"`,
      suggestions: [
        "Skrive kort og profesjonelt.",
        "Unngaa klisjeer og oversatt tone.",
        "Gjore verdien tydelig tidlig."
      ],
      selected: "Velger en klar og brukbar nettsidetekst."
    };
  }

  return {
    modeLabel: "Standard",
    summary: `Titan vurderer hvordan prompten boer besvares: "${prompt}"`,
    suggestions: [
      "Svare kort og direkte.",
      "Holde tonen trygg og profesjonell.",
      "Velge et format som passer oppgaven."
    ],
    selected: "Velger et tydelig svar med minst mulig tull."
  };
}

async function requestTitanResponse({ endpoint, prompt, model, modelPreset, mode, signal }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt, model, modelPreset, mode }),
    signal
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Titan svarte ikke.");
  }
  return payload;
}

function injectMotionStyles() {
  if (document.getElementById("motion-styles")) return;

  const style = document.createElement("style");
  style.id = "motion-styles";
  style.textContent = `
    :root { --ease-smooth: cubic-bezier(0.22, 1, 0.36, 1); }
    html { scroll-behavior: smooth; }
    body {
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 520ms var(--ease-smooth), transform 520ms var(--ease-smooth);
    }
    body.page-ready { opacity: 1; transform: translateY(0); }
    body.page-exit { opacity: 0; transform: translateY(16px); }
    .site-header, .site-footer, .hero, .content-panel, .contact-panel, .project-card, .tool-card,
    .portal-panel, .chat-panel, .auth-card, .notice-center, .tool-main, .tool-sidebar {
      transition: transform 320ms var(--ease-smooth), box-shadow 320ms var(--ease-smooth),
        background-color 320ms var(--ease-smooth), border-color 320ms var(--ease-smooth);
    }
    .project-card:hover, .tool-card:hover, .content-panel:hover, .contact-panel:hover,
    .hero-card:hover, .trust-card:hover { transform: translateY(-4px); }
    .site-nav a, .footer-links a, .primary-button, .tool-list-button, .ghost-button, .portal-return,
    .model-label, .tag, .channel-pill, .support-status, .support-badge, .secondary-action {
      transition: transform 220ms var(--ease-smooth), opacity 220ms var(--ease-smooth),
        background-color 220ms var(--ease-smooth), color 220ms var(--ease-smooth),
        box-shadow 220ms var(--ease-smooth);
    }
    .site-nav a:hover, .footer-links a:hover, .primary-button:hover, .tool-list-button:hover,
    .ghost-button:hover, .portal-return:hover, .model-label:hover, .secondary-action:hover {
      transform: translateY(-2px);
    }
    .reveal {
      opacity: 0;
      transform: translateY(24px) scale(0.985);
      transition: opacity 700ms var(--ease-smooth), transform 700ms var(--ease-smooth);
      will-change: opacity, transform;
    }
    .reveal.is-visible { opacity: 1; transform: translateY(0) scale(1); }
    .reveal-delay-1 { transition-delay: 70ms; }
    .reveal-delay-2 { transition-delay: 140ms; }
    .reveal-delay-3 { transition-delay: 210ms; }
    .reveal-delay-4 { transition-delay: 280ms; }
    .reveal-delay-5 { transition-delay: 350ms; }
    .reveal-delay-6 { transition-delay: 420ms; }
  `;
  document.head.appendChild(style);
}

function renderHeader() {
  const host = document.querySelector("[data-site-header]");
  if (!host) return;

  const current = document.body.dataset.page;
  const brandText = document.body.dataset.brand || "Konfidensiell";

  host.innerHTML = `
    <header class="site-header">
      <a class="brand" href="index.html" aria-label="Gå til forsiden">
        <img src="assets/images/brand-mark.svg" alt="" />
        <span>${brandText}</span>
      </a>
      <nav class="site-nav" aria-label="Hovednavigasjon">
        ${navigationItems
          .map(
            (item) =>
              `<a href="${item.href}" class="${item.key === current ? "active" : ""}">${item.label}</a>`
          )
          .join("")}
      </nav>
    </header>
  `;
}

function renderFooter() {
  const host = document.querySelector("[data-site-footer]");
  if (!host) return;

  host.innerHTML = `
    <footer class="site-footer">
      <div class="footer-inner">
        <a class="brand" href="index.html" aria-label="Gå til forsiden">
          <img src="assets/images/brand-mark.svg" alt="" />
          <span>Konfidensiell</span>
        </a>
        <div class="footer-copy">© 2026 Konfidensiell. Alle rettigheter reservert.</div>
        <div class="footer-links">
          ${footerLinks.map((link) => `<a href="${link.href}">${link.label}</a>`).join("")}
        </div>
      </div>
    </footer>
  `;
}

function bindPortalLogin() {
  const form = document.querySelector("[data-portal-login]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = "verktoy.html";
  });
}

function bindRegistration() {
  const form = document.querySelector("[data-register-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = "verktoy.html";
  });
}

function bindSimpleChat() {
  document.querySelectorAll("[data-chat-form]").forEach((form) => {
    const input = form.querySelector("input, textarea");
    const output = document.querySelector(form.dataset.outputTarget);
    if (!input || !output) return;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      output.textContent = `Hei! Jeg er din personlige assistent. Du skrev: "${value}"`;
      input.value = "";
    });
  });
}

function bindModelPickers() {
  document.querySelectorAll("[data-model-group]").forEach((group) => {
    const setKey = group.dataset.modelGroup;
    const models = modelSets[setKey] || [];
    const trigger = group.querySelector("[data-model-trigger]");
    const labelTrigger = group.querySelector("[data-model-label]");
    const menu = group.querySelector("[data-model-menu]");
    const input = group.querySelector("[data-model-input]");
    const prompt = group.closest("[data-ai-page]")?.querySelector("[data-ai-response]");
    const currentModel = group.closest("[data-ai-page]")?.querySelector("[data-selected-model]");
    const dropdown = group.querySelector(".model-dropdown");
    const shell = group.closest("[data-ai-page]");
    const thinkingDrawer = shell?.querySelector("[data-titan-thinking]");
    const thinkingToggle = shell?.querySelector("[data-thinking-toggle]");
    const thinkingToggleLabel = shell?.querySelector("[data-thinking-toggle-label]");
    const conversationList = shell?.querySelector("[data-conversation-list]");
    let sessions = loadTitanSessions();
    let activeChatId = sessions[0]?.id || null;

    if (!trigger || !labelTrigger || !menu || !input || !dropdown) return;

    renderConversationList(conversationList, sessions, activeChatId);

    thinkingToggle?.addEventListener("click", () => {
      const expanded = thinkingToggle.getAttribute("aria-expanded") === "true";
      thinkingToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      if (thinkingDrawer) thinkingDrawer.hidden = expanded;
    });

    menu.innerHTML = models
      .map((model) => `<button class="model-option" type="button" data-model-option="${model}">${model}</button>`)
      .join("");

    const toggleMenu = () => {
      dropdown.classList.toggle("open");
    };

    trigger.addEventListener("click", toggleMenu);
    labelTrigger.addEventListener("click", toggleMenu);

    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-model-option]");
      if (!option) return;
      if (currentModel) currentModel.textContent = option.dataset.modelOption;
      dropdown.classList.remove("open");
    });

    document.addEventListener("click", (event) => {
      if (!group.contains(event.target)) dropdown.classList.remove("open");
    });

    conversationList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-chat-id]");
      if (!button || !shell) return;
      const session = sessions.find((item) => item.id === button.dataset.chatId);
      if (!session) return;

      activeChatId = session.id;
      renderConversationList(conversationList, sessions, activeChatId);

      const thinkingSummary = shell.querySelector("[data-thinking-summary]");
      const thinkingList = shell.querySelector("[data-thinking-list]");
      const thinkingChoice = shell.querySelector("[data-thinking-choice]");
      const status = shell.querySelector("[data-titan-status]");
      const mode = shell.querySelector("[data-titan-mode]");
      const meta = shell.querySelector("[data-titan-meta]");

      if (currentModel) currentModel.textContent = session.modelLabel;
      if (input) input.value = session.prompt;
      if (prompt) prompt.textContent = session.reply;
      if (thinkingSummary) thinkingSummary.textContent = session.thinking.summary;
      if (thinkingList) {
        thinkingList.innerHTML = session.thinking.suggestions.map((item) => `<li>${item}</li>`).join("");
      }
      if (thinkingChoice) thinkingChoice.textContent = session.thinking.selected;
      if (status) status.textContent = "Klar";
      if (mode) mode.textContent = `Modus: ${session.thinking.modeLabel || "Standard"}`;
      if (meta) meta.textContent = session.meta || "Status: hentet fra lagret chat.";
      if (thinkingToggleLabel) thinkingToggleLabel.textContent = "Se hvordan Titan tenkte";
    });

    group.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value || !prompt) return;
      if (!shell) return;

      const thinkingSummary = shell.querySelector("[data-thinking-summary]");
      const thinkingList = shell.querySelector("[data-thinking-list]");
      const thinkingChoice = shell.querySelector("[data-thinking-choice]");
      const status = shell.querySelector("[data-titan-status]");
      const mode = shell.querySelector("[data-titan-mode]");
      const meta = shell.querySelector("[data-titan-meta]");
      const stop = shell.querySelector("[data-titan-stop]");
      const activeModel = currentModel ? currentModel.textContent.trim() : models[0] || "Modell";
      const modelPreset = inferModelPreset(activeModel);
      const endpoint = document.body.dataset.titanEndpoint;
      const thinking = buildThinkingData(value, inferTitanMode(value));

      if (thinkingSummary) thinkingSummary.textContent = thinking.summary;
      if (thinkingList) {
        thinkingList.innerHTML = thinking.suggestions.map((item) => `<li>${item}</li>`).join("");
      }
      if (thinkingChoice) thinkingChoice.textContent = thinking.selected;
      if (thinkingDrawer) thinkingDrawer.hidden = true;
      if (thinkingToggle) thinkingToggle.setAttribute("aria-expanded", "false");
      if (thinkingToggleLabel) thinkingToggleLabel.textContent = "Tenker...";
      if (status) status.textContent = "Live";
      if (mode) mode.textContent = `Modus: ${thinking.modeLabel}`;
      if (meta) meta.textContent = `Status: sender prompt til ${activeModel}.`;
      prompt.textContent = "Titan tenker...";
      clearCodeCanvas(shell);

      titanAbortController?.abort();
      titanAbortController = new AbortController();

      if (stop) {
        stop.onclick = () => {
          titanAbortController?.abort();
          if (status) status.textContent = "Stoppet";
          if (meta) meta.textContent = "Generering stoppet manuelt.";
        };
      }

      if (!endpoint || endpoint.includes("your-titan-worker")) {
        prompt.textContent = "Titan-endpoint er ikke satt opp ennå. Legg inn Cloudflare worker-URL i data-titan-endpoint paa body-taggen.";
        if (status) status.textContent = "Mangler API";
        if (meta) meta.textContent = "Frontend er klar, men backend-URL mangler.";
        input.value = "";
        return;
      }

      requestTitanResponse({
        endpoint,
        prompt: value,
        model: activeModel,
        modelPreset,
        mode: inferTitanMode(value),
        signal: titanAbortController.signal
      })
        .then((payload) => {
          const replyText = payload.reply || "Titan ga ikke noe svar.";
          const files = parseTitanFiles(replyText, value, inferTitanMode(value));
          if (files.length) {
            prompt.textContent = "";
            renderCodeCanvas(shell, files);
          } else {
            clearCodeCanvas(shell);
            prompt.textContent = replyText;
          }
          if (status) status.textContent = "Klar";
          if (meta) {
            const tokens = payload.tokens ? `${payload.tokens} tokens` : "ukjent tokenbruk";
            meta.textContent = `Status: ferdig med ${tokens}.`;
          }
          if (thinkingSummary && payload.thinking?.summary) thinkingSummary.textContent = payload.thinking.summary;
          if (thinkingList && payload.thinking?.suggestions) {
            thinkingList.innerHTML = payload.thinking.suggestions.map((item) => `<li>${item}</li>`).join("");
          }
          if (thinkingChoice && payload.thinking?.selected) thinkingChoice.textContent = payload.thinking.selected;
          if (thinkingToggleLabel) thinkingToggleLabel.textContent = "Se hvordan Titan tenkte";

          const session = {
            id: activeChatId || `${Date.now()}`,
            title: makeChatTitle(value),
            prompt: value,
            reply: payload.reply || "",
            modelLabel: activeModel,
            thinking: {
              summary: payload.thinking?.summary || thinking.summary,
              suggestions: payload.thinking?.suggestions || thinking.suggestions,
              selected: payload.thinking?.selected || thinking.selected,
              modeLabel: thinking.modeLabel
            },
            meta: meta?.textContent || ""
          };
          activeChatId = session.id;
          sessions = [session, ...sessions.filter((item) => item.id !== session.id)];
          saveTitanSessions(sessions);
          renderConversationList(conversationList, sessions, activeChatId);
        })
        .catch((error) => {
          clearCodeCanvas(shell);
          prompt.textContent = error.name === "AbortError" ? "Genereringen ble stoppet." : `Feil: ${error.message}`;
          if (status) status.textContent = "Feil";
          if (meta) meta.textContent = "Status: kunne ikke hente svar fra Titan.";
          if (thinkingToggleLabel) thinkingToggleLabel.textContent = "Se hvordan Titan tenkte";
        });
      input.value = "";
    });
  });
}

function markPageReady() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add("page-ready");
    });
  });
}

function addRevealClasses() {
  const groups = [
    ".hero-inner > *",
    ".trust-strip > *",
    ".project-grid > *",
    ".about-grid > *",
    ".tool-overview > *",
    ".portal-links > *",
    ".form-grid > *",
    ".support-shell > *"
  ];

  groups.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      element.classList.add("reveal");
      element.classList.add(`reveal-delay-${Math.min(index + 1, 6)}`);
    });
  });

  document.querySelectorAll(".auth-card, .chat-panel, .portal-panel, .notice-center").forEach((element) => {
    element.classList.add("reveal", "is-visible");
  });
}

function setupReveal() {
  const targets = document.querySelectorAll(".reveal:not(.is-visible)");
  if (!targets.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach((target) => observer.observe(target));
}

function setupPageTransitions() {
  document.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (link.target === "_blank") return;

    link.addEventListener("click", (event) => {
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      document.body.classList.add("page-exit");
      window.setTimeout(() => {
        window.location.href = url.href;
      }, 240);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  injectMotionStyles();
  renderHeader();
  renderFooter();
  bindPortalLogin();
  bindRegistration();
  bindSimpleChat();
  bindModelPickers();
  addRevealClasses();
  markPageReady();
  setupReveal();
  setupPageTransitions();
});
