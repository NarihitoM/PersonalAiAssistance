import mongoose from "mongoose";
import { MONGO_URI } from "../config/database.js";

export const mongoconnect = async () => {
    await mongoose.connect(MONGO_URI).then(() => console.log("connect")).catch(() => console.log("Error"));
}