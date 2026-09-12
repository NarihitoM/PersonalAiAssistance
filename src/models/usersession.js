import mongoose from "mongoose";

const Usersession = new mongoose.Schema({
    userid : { type : String },
    session : {type : String, default : "chat"}
})

export default mongoose.model("Usersession",Usersession);

