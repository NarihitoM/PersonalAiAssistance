import { message } from "../controllers/messagecontroller.js";
import { command } from "../controllers/commandcontroller.js";
import { createbot } from "../config/botservice.js";
import { configDotenv } from "dotenv";
import { mongoconnect } from "../config/mongoservice.js";

configDotenv();

const token = process.env.TOKEN;

await mongoconnect();

const bot = createbot(token);

//Global Chat
bot.on("message", message(bot));
//Command Chat
bot.onText(/\//, command(bot));

module.exports = async (request, response) => {
    try {
        if (request.method === 'POST') {
            await bot.processUpdate(request.body);
        }
        response.status(200).send('OK');
    } catch (error) {
        console.error('Error handling update:', error);
        response.status(500).send('Error');
    }
};