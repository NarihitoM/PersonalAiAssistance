import { message } from "./controllers/messagecontroller.js";
import { createbot } from "./config/botservice.js";
import { configDotenv } from "dotenv";

configDotenv();

const bot = createbot(process.env.TOKEN);

bot.on("message", message(bot));

console.log("Server running.")