import { message } from "./controllers/messagecontroller.js";
import { command } from "./controllers/commandcontroller.js";
import { createbot } from "./config/botservice.js";
import { configDotenv } from "dotenv";
import { mongoconnect } from "./config/mongoservice.js";

configDotenv();

await mongoconnect();

const bot = createbot(process.env.TOKEN);

//Global Chat
bot.on("message", message(bot));
//Command Chat
bot.onText(/\// , command(bot));

console.log("Server running.")