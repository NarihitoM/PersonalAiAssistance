import mongoose from "mongoose";

const UserSession = await mongoose.Schema({
    userid: { type: String, required: true, unique: true },
    session: { type: String, default: "chat" }
});

export default mongoose.model("UserSession", UserSession);
