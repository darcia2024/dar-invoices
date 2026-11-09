const { clearSessionCookie, requestWorkspace } = require("./_session");

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.setHeader("Set-Cookie", clearSessionCookie(requestWorkspace(req)));
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Logout gagal" });
  }
};
