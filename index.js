import { message } from "./controllers/messagecontroller.js";
import { createbot } from "./config/botservice.js";
import { configDotenv } from "dotenv";
import { mongoconnect } from "./config/mongoservice.js";

configDotenv();

await mongoconnect();

const bot = createbot(process.env.TOKEN);
bot.on("message", message(bot));

console.log("Server running.")