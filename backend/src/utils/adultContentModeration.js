const DEFAULT_STRONG_KEYWORDS = [
  "porn",
  "xxx",
  "nude",
  "naked",
  "hentai",
  "onlyfans",
  "jav",
  "pussy",
  "boobs",
  "dick",
  "blowjob",
  "deepfake porn",
  "khoa than",
  "coi do",
  "khoe than",
  "anh nong",
  "clip nong",
  "phim sex",
  "sex tape",
  "dit nhau",
  "bu cu",
];

const DEFAULT_MEDIUM_KEYWORDS = [
  "18+",
  "adult",
  "nsfw",
  "sex",
  "sexy",
  "erotic",
  "lingerie",
  "bikini",
  "goi duc",
  "nhay cam",
];

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toNumber(value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, min), max);
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeywordList(input = [], fallback = []) {
  const merged = Array.isArray(input) ? input : [input];
  const combined = [...fallback, ...merged];
  return Array.from(
    new Set(
      combined
        .map((item) => normalizeText(item))
        .filter(Boolean),
    ),
  );
}

function parseKeywordEnv(envName) {
  const raw = String(process.env[envName] || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function buildKeywordConfig() {
  const strongKeywords = normalizeKeywordList(parseKeywordEnv("ADULT_STRONG_KEYWORDS"), DEFAULT_STRONG_KEYWORDS);
  const mediumKeywords = normalizeKeywordList(parseKeywordEnv("ADULT_MEDIUM_KEYWORDS"), DEFAULT_MEDIUM_KEYWORDS);
  return { strongKeywords, mediumKeywords };
}

function matchKeywordsInText(text = "", keywords = []) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return [];
  const found = [];
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (normalizedText.includes(keyword)) found.push(keyword);
  }
  return found;
}

function buildTextCandidates(payload = {}) {
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const collaborators = Array.isArray(payload.collaborators) ? payload.collaborators : [];
  return [
    payload.content,
    payload.altText,
    payload.location,
    ...tags,
    ...collaborators,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function buildMediaCandidates(media = []) {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item) => [
    item?.filename,
    item?.mimeType,
    item?.url,
  ])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function scoreHeuristicModeration({ payload = {}, media = [] } = {}) {
  const { strongKeywords, mediumKeywords } = buildKeywordConfig();
  const textCandidates = buildTextCandidates(payload);
  const mediaCandidates = buildMediaCandidates(media);

  const textStrong = new Set();
  const textMedium = new Set();
  const mediaStrong = new Set();
  const mediaMedium = new Set();

  for (const candidate of textCandidates) {
    for (const keyword of matchKeywordsInText(candidate, strongKeywords)) textStrong.add(keyword);
    for (const keyword of matchKeywordsInText(candidate, mediumKeywords)) textMedium.add(keyword);
  }
  for (const candidate of mediaCandidates) {
    for (const keyword of matchKeywordsInText(candidate, strongKeywords)) mediaStrong.add(keyword);
    for (const keyword of matchKeywordsInText(candidate, mediumKeywords)) mediaMedium.add(keyword);
  }

  let score = 0;
  score += textStrong.size * 5;
  score += textMedium.size * 3;
  score += mediaStrong.size * 6;
  score += mediaMedium.size * 4;

  const hasTextSignals = textStrong.size > 0 || textMedium.size > 0;
  const hasMediaSignals = mediaStrong.size > 0 || mediaMedium.size > 0;
  if (hasTextSignals && hasMediaSignals) score += 2;

  const threshold = toNumber(process.env.ADULT_MODERATION_SCORE_THRESHOLD, 6, 1, 100);
  const flagged = score >= threshold;
  const signals = Array.from(new Set([
    ...textStrong,
    ...textMedium,
    ...mediaStrong,
    ...mediaMedium,
  ])).slice(0, 20);

  const reasons = [];
  if (textStrong.size) reasons.push(`strong-text:${textStrong.size}`);
  if (textMedium.size) reasons.push(`medium-text:${textMedium.size}`);
  if (mediaStrong.size) reasons.push(`strong-media:${mediaStrong.size}`);
  if (mediaMedium.size) reasons.push(`medium-media:${mediaMedium.size}`);

  return {
    flagged,
    score,
    threshold,
    signals,
    reasons,
  };
}

function normalizeProviderResponse(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;

  const flagged =
    raw.flagged === true ||
    raw.isAdult === true ||
    raw.isExplicit === true ||
    raw.violation === true;

  let score = toNumber(raw.score ?? raw.riskScore ?? raw.confidence ?? 0, 0, 0, 100);
  if (score > 0 && score <= 1) score = Math.round(score * 100);

  const signalsRaw = Array.isArray(raw.signals)
    ? raw.signals
    : Array.isArray(raw.labels)
      ? raw.labels
      : Array.isArray(raw.categories)
        ? raw.categories
        : [];

  const signals = Array.from(
    new Set(
      signalsRaw
        .map((item) => normalizeText(item))
        .filter(Boolean),
    ),
  );

  return {
    flagged,
    score,
    signals,
    reason: String(raw.reason || raw.message || "").trim(),
  };
}

async function callProviderModeration({ payload = {}, media = [], deadlineAt = null } = {}) {
  const providerUrl = String(process.env.ADULT_MODERATION_PROVIDER_URL || "").trim();
  if (!providerUrl) {
    return { available: false };
  }
  if (typeof fetch !== "function") {
    return { available: false };
  }

  const providerToken = String(process.env.ADULT_MODERATION_PROVIDER_TOKEN || "").trim();
  const configuredTimeoutMs = toNumber(process.env.ADULT_MODERATION_PROVIDER_TIMEOUT_MS, 15000, 500, 300000);
  const scoreThreshold = toNumber(process.env.ADULT_PROVIDER_SCORE_THRESHOLD, 70, 1, 100);
  let timeoutMs = configuredTimeoutMs;

  if (deadlineAt) {
    const deadlineTime = new Date(deadlineAt).getTime();
    if (Number.isFinite(deadlineTime)) {
      const remainingMs = deadlineTime - Date.now() - 250;
      if (remainingMs <= 0) {
        return { available: false, error: "moderation_deadline_exceeded" };
      }
      timeoutMs = Math.min(configuredTimeoutMs, Math.max(Math.floor(remainingMs), 500));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(providerToken ? { Authorization: `Bearer ${providerToken}` } : {}),
      },
      body: JSON.stringify({
        textCandidates: buildTextCandidates(payload),
        media: (Array.isArray(media) ? media : []).map((item) => ({
          type: item?.type || "",
          url: item?.url || "",
          mimeType: item?.mimeType || "",
          filename: item?.filename || "",
          size: Number(item?.size) || 0,
        })),
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (_error) {
      data = null;
    }

    if (!response.ok) {
      return {
        available: false,
        error: `provider_http_${response.status}`,
      };
    }

    const normalized = normalizeProviderResponse(data);
    if (!normalized) return { available: false };

    return {
      available: true,
      scoreThreshold,
      ...normalized,
    };
  } catch (error) {
    return {
      available: false,
      error: error?.name === "AbortError" ? "provider_timeout" : "provider_request_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function assessAdultContent({ payload = {}, media = [], deadlineAt = null } = {}) {
  const enabled = parseBoolean(process.env.AUTO_ADULT_MODERATION_ENABLED, true);
  if (!enabled) {
    return {
      enabled: false,
      flagged: false,
      score: 0,
      threshold: toNumber(process.env.ADULT_MODERATION_SCORE_THRESHOLD, 6, 1, 100),
      source: "disabled",
      signals: [],
      reasons: [],
      providerUsed: false,
      providerFlagged: false,
      providerScore: 0,
    };
  }

  const heuristic = scoreHeuristicModeration({ payload, media });
  const provider = await callProviderModeration({ payload, media, deadlineAt });
  const providerUsed = Boolean(provider.available);
  const providerFlagged =
    providerUsed &&
    (provider.flagged === true || Number(provider.score || 0) >= Number(provider.scoreThreshold || 100));

  const flagged = heuristic.flagged || providerFlagged;
  const mergedSignals = Array.from(
    new Set([
      ...(heuristic.signals || []),
      ...(provider.signals || []),
    ]),
  ).slice(0, 20);

  const reasons = [
    ...(heuristic.reasons || []),
    ...(provider.reason ? [provider.reason] : []),
    ...(provider.error ? [provider.error] : []),
  ].slice(0, 10);

  const source = providerUsed
    ? heuristic.flagged && providerFlagged
      ? "hybrid"
      : providerFlagged
        ? "provider"
        : "heuristic"
    : "heuristic";

  return {
    enabled: true,
    flagged,
    score: Number(heuristic.score || 0),
    threshold: Number(heuristic.threshold || 0),
    source,
    signals: mergedSignals,
    reasons,
    providerUsed,
    providerFlagged,
    providerScore: Number(provider.score || 0),
    providerScoreThreshold: Number(provider.scoreThreshold || 0),
  };
}

module.exports = {
  assessAdultContent,
};
