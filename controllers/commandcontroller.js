import usersession from "../model/usersession.js";
//Command

export const command = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    const message = msg.text;
    console.log(message);

   if (message === "/imagetool") {
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
        const user = await usersession.findOne({ userid: chatid });
        await bot.sendMessage(chatid, `Your current session is : ${user.session === "chat" ? "Chatmode" : "Imagetool Mode"}`);
    }
    else {
        await bot.sendMessage(chatid, "There is no commant with that function.")
    }
}