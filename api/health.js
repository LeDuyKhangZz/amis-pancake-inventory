import { configurationStatus, SERVICE_NAME } from "../lib/config.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  return res.status(200).json({ ok: true, service: SERVICE_NAME, configured: configurationStatus() });
}
