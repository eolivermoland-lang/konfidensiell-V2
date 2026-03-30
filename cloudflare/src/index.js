const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function inferMode(prompt = "") {
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

function wantsMultiFile(prompt = "") {
  const text = prompt.toLowerCase();
  return (
    text.includes("flere filer") ||
    text.includes("mer enn en fil") ||
    text.includes("ikke bare en") ||
    text.includes("html og css") ||
    text.includes("html css") ||
    text.includes("css og javascript") ||
    text.includes("html css javascript") ||
    text.includes("html, css") ||
    text.includes("html, css, javascript") ||
    text.includes("script.js") ||
    text.includes("styles.css")
  );
}

function resolveModel(modelPreset, fallback) {
  if (modelPreset === "pro") return "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  if (modelPreset === "thinking") return "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";
  if (modelPreset === "fast") return "@cf/meta/llama-3.1-8b-instruct";
  return fallback || "@cf/meta/llama-3.1-8b-instruct";
}

function sanitizeReply(reply = "") {
  let cleaned = String(reply || "");
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  cleaned = cleaned.replace(/<\/?think>/gi, " ");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.trim();
  return cleaned || "Titan svarte ikke med brukbar tekst.";
}

function extractFileNames(reply = "") {
  const text = String(reply || "");
  const names = new Set();
  const structuredPattern = /===FILE:\s*([^\n=]+?)===/g;
  let match;

  while ((match = structuredPattern.exec(text))) {
    names.add(match[1].trim().toLowerCase());
  }

  if (!names.size) {
    if (/<link[^>]+href=["']styles\.css["']/i.test(text)) names.add("styles.css");
    if (/<script[^>]+src=["']script\.js["']/i.test(text)) names.add("script.js");
    if (/<html|<!doctype html/i.test(text)) names.add("index.html");
  }

  return [...names];
}

function generationSettings(mode, modelPreset) {
  if (modelPreset === "thinking") {
    return { max_tokens: mode === "code" ? 900 : 320, temperature: 0.25 };
  }
  if (modelPreset === "pro") {
    return { max_tokens: mode === "code" ? 760 : 260, temperature: 0.2 };
  }
  if (modelPreset === "fast") {
    return { max_tokens: mode === "code" ? 420 : 180, temperature: 0.15 };
  }
  return { max_tokens: mode === "code" ? 560 : 220, temperature: 0.18 };
}

function buildThinking(prompt, mode) {
  if (mode === "code") {
    return {
      summary: `Titan tolker forespoerselen som kode: "${prompt}"`,
      suggestions: [
        "Svare med kode foerst.",
        "Holde komponenten kort og komplett.",
        "Unngaa lange introduksjoner."
      ],
      selected: "Velger kodefoerst med minst mulig fluff."
    };
  }

  if (mode === "default") {
    return {
      summary: `Titan leser spoersmaalet og vurderer hva brukeren egentlig vil ha: "${prompt}"`,
      suggestions: [
        "Svare kort og naturlig.",
        "Velge trygg norsk uten rare formuleringer.",
        "Holde svaret konkret."
      ],
      selected: "Velger et kort, tydelig svar i naturlig bokmaal."
    };
  }

  if (mode === "website") {
    return {
      summary: `Titan tolker forespoerselen som nettsidetekst: "${prompt}"`,
      suggestions: [
        "Skrive kort og profesjonelt.",
        "Unngaa klisjeer.",
        "Holde norsk flyt ren."
      ],
      selected: "Velger en tydelig og brukbar nettsidetekst."
    };
  }

  return {
    summary: `Titan vurderer hvordan prompten boer besvares: "${prompt}"`,
    suggestions: [
      "Svare kort og profesjonelt.",
      "Holde norsk flyt ren.",
      "Velge format etter oppgaven."
    ],
    selected: "Velger et tydelig og kontrollert svar."
  };
}

function systemPrompt(mode, prompt = "") {
  const shared =
    "Du er Titan, en skarp og profesjonell AI-assistent. Svar paa naturlig norsk bokmaal. " +
    "Unngaa HTML, markdown og kode med mindre brukeren eksplisitt ber om kode.";

  if (mode === "code") {
    const multifile = wantsMultiFile(prompt);
    return (
      shared +
      " Brukeren vil ha kode. Lever kode foerst. Unngaa introduksjoner. Hold svaret konkret." +
      " Hvis brukeren ber om en enkelt fil, svar kun med én fil i dette formatet: ===FILE:index.html=== etterfulgt av en kodeblokk." +
      (multifile
        ? " Brukeren ber om flere filer. Du MAA returnere minst disse seksjonene hvis oppgaven passer: ===FILE:index.html===, ===FILE:styles.css=== og ===FILE:script.js===."
        : " Hvis brukeren ber om flere filer, svar med flere seksjoner i denne rekkefolgen naar det passer: ===FILE:index.html===, ===FILE:styles.css===, ===FILE:script.js===.") +
      " Hver seksjon skal inneholde kun riktig kodeblokk for den filen. Ingen forklarende tekst foer eller etter."
    );
  }

  if (mode === "bio") {
    return shared + " Brukeren vil ha en bio. Svar kun med ren tekst og en kort, troverdig bio.";
  }

  if (mode === "website") {
    return shared + " Brukeren vil ha nettsidetekst. Skriv klart, profesjonelt og uten klisjeer.";
  }

  if (mode === "rewrite") {
    return shared + " Brukeren vil ha omskriving. Behold meningen, men gjoer teksten klarere og mer profesjonell.";
  }

  return shared + " Svar kort, tydelig og uten tull.";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (new URL(request.url).pathname !== "/api/titan" || request.method !== "POST") {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    const payload = await request.json().catch(() => ({}));
    const prompt = (payload.prompt || "").trim();
    const mode = payload.mode || inferMode(prompt);
    const modelPreset = payload.modelPreset || "standard";

    if (!prompt) {
      return Response.json({ error: "Prompt mangler." }, { status: 400, headers: corsHeaders });
    }

    const model = resolveModel(modelPreset, env.TITAN_MODEL);
    const settings = generationSettings(mode, modelPreset);

    const runModel = (messages) =>
      env.AI.run(model, {
        messages,
        max_tokens: settings.max_tokens,
        temperature: settings.temperature
      });

    let result = await runModel([
      { role: "system", content: systemPrompt(mode, prompt) },
      { role: "user", content: prompt }
    ]);

    const rawReply =
      result.response ||
      result.result?.response ||
      result.output_text ||
      "Titan svarte ikke.";
    let reply = sanitizeReply(rawReply);

    if (mode === "code" && wantsMultiFile(prompt)) {
      const files = extractFileNames(reply);
      const needsRetry =
        !(files.includes("index.html") && files.includes("styles.css") && files.includes("script.js"));

      if (needsRetry) {
        result = await runModel([
          { role: "system", content: systemPrompt(mode, prompt) },
          {
            role: "user",
            content:
              `${prompt}\n\n` +
              "Du svarte ikke med alle filene. Returner nøyaktig tre seksjoner og bare disse filene: " +
              "===FILE:index.html===, ===FILE:styles.css=== og ===FILE:script.js===. " +
              "Hver seksjon må ha en kodeblokk med innhold. Ingen forklaring."
          }
        ]);

        const retryRawReply =
          result.response ||
          result.result?.response ||
          result.output_text ||
          rawReply;
        reply = sanitizeReply(retryRawReply);
      }
    }

    return Response.json(
      {
        reply,
        mode,
        model,
        tokens: result.usage?.total_tokens || result.result?.usage?.total_tokens || null,
        thinking: buildThinking(prompt, mode)
      },
      { headers: corsHeaders }
    );
  }
};
