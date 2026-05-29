const DEFAULT_LOCAL_MEDIA_BASE_URL = "http://localhost:4000";

function trimTrailingSlash(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function firstHeaderValue(value = "") {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return String(value || "")
    .split(",")[0]
    .trim();
}

function isLoopbackHost(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return (
    normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || normalized === "[::1]"
  );
}

function toAbsoluteOrigin(value = "") {
  const raw = trimTrailingSlash(value);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_error) {
    return "";
  }
}

function deriveRequestOrigin(req) {
  if (!req) return "";

  const protocol = firstHeaderValue(req.headers?.["x-forwarded-proto"]) || req.protocol || "http";
  const host = firstHeaderValue(req.headers?.["x-forwarded-host"])
    || firstHeaderValue(req.headers?.host);

  if (!host) return "";
  return toAbsoluteOrigin(`${protocol}://${host}`);
}

function getPublicMediaBaseUrl(req) {
  const configured = toAbsoluteOrigin(process.env.MEDIA_PUBLIC_BASE_URL);
  const requestOrigin = deriveRequestOrigin(req);

  if (configured) {
    try {
      const parsed = new URL(configured);
      if (!isLoopbackHost(parsed.hostname)) return configured;
    } catch (_error) {
      // Fall through to request-derived/public fallback.
    }
  }

  if (requestOrigin) return requestOrigin;
  if (configured) return configured;
  return DEFAULT_LOCAL_MEDIA_BASE_URL;
}

function normalizeUploadsPath(raw = "") {
  const clean = String(raw || "").trim().replace(/\\/g, "/");
  if (!clean) return "";

  const uploadsIndex = clean.toLowerCase().indexOf("/uploads/");
  if (uploadsIndex >= 0) return clean.slice(uploadsIndex);
  if (clean.toLowerCase().startsWith("uploads/")) return `/${clean}`;
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function normalizePublicMediaUrl(url = "", options = {}) {
  const raw = String(url || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  if (/^(data:|blob:)/i.test(raw)) return raw;

  const baseUrl = getPublicMediaBaseUrl(options.req);

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const fullPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (fullPath.toLowerCase().includes("/uploads/") && isLoopbackHost(parsed.hostname)) {
        return `${baseUrl}${normalizeUploadsPath(fullPath)}`;
      }
      return parsed.toString();
    } catch (_error) {
      return raw;
    }
  }

  return `${baseUrl}${normalizeUploadsPath(raw)}`;
}

module.exports = {
  DEFAULT_LOCAL_MEDIA_BASE_URL,
  deriveRequestOrigin,
  getPublicMediaBaseUrl,
  isLoopbackHost,
  normalizePublicMediaUrl,
};
