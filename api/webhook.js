import { createbot } from "../config/botservice.js";

const bot = createbot(process.env.TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Webhook active");
  }

  try {
    await bot.processUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
}
