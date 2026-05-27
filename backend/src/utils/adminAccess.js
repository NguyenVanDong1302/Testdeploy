function normalizeAllowList(raw = "") {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getAdminAllowList() {
  const usernames = normalizeAllowList(process.env.ADMIN_USERNAMES || "admin");
  const emails = normalizeAllowList(process.env.ADMIN_EMAILS || "");
  return { usernames, emails };
}

function isUserAdmin(user = {}) {
  if (String(user.role || "").toLowerCase() === "admin") return true;

  const username = String(user.username || "").trim().toLowerCase();
  const email = String(user.email || "").trim().toLowerCase();
  const { usernames, emails } = getAdminAllowList();

  if (username && usernames.includes(username)) return true;
  if (email && emails.includes(email)) return true;
  return false;
}

module.exports = {
  getAdminAllowList,
  isUserAdmin,
};
