import mongoose from "mongoose";

const ProcessedMessage = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    chatId: { type: String },
    messageId: { type: Number },
    createdAt: { type: Date, default: Date.now, expires: 300 }
});

export default mongoose.models.ProcessedMessage || mongoose.model("ProcessedMessage", ProcessedMessage);
