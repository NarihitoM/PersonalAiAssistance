import mongoose from "mongoose";

const Usersession = new mongoose.Schema({
    userid : { type : String },
    session : {type : String}
})

export default mongoose.model("Usersession",Usersession);

