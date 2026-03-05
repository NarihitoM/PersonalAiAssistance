import usersession from "../model/usersession.js";
//Command

export const command = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    const message = msg.text;
    console.log(message);

    if (message === "/start") {
        await bot.sendMessage(chatid, "You can now get started! This is your personal ai assistance that can help you with anything. Develop By Narihito")
    }

    else if (message === "/feature") {
        await bot.sendMessage(chatid, "This Assistance can chat,read file,analyse image,transcript video,record voice,create file,hear your voice,etc")
    }
    else if (message === "/imagetool") {
        await usersession.findOneAndUpdate({
            userid: chatid
        }, {
            $set: {
                session: "imagetool"
            }
        }, {
            upsert: true
        });
        await bot.sendMessage(chatid, "You are now in image tool mode.")
    }
    else if (message === "/exit") {
        await usersession.findOneAndUpdate({
            userid: chatid
        }, {
            $set: {
                session: "chat"
            }
        }, {
            upsert: true
        })
        await bot.sendMessage(chatid, "You are now in normal chat mode.")
    }
    else if (message === "/sessionstatus") {
        try {
            const session = await usersession.findOne({ userid: msg.chat.id });
            if (!session) {
                await bot.sendMessage(chatid, "You have no session. Press /start to get started.")
                return;
            }
        }
        catch (err) {
            await bot.sendMessage(chatid, "You have no session. Press /start to get started.")
        }
        
        await bot.sendMessage(chatid, `Your current session is : ${session.session === "chat" ? "Chatmode" : "Imagetool Mode"}`);
    }
    else {
        await bot.sendMessage(chatid, "There is no commant with that function.")
    }
}