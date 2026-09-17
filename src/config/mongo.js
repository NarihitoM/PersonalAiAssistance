import { config } from "dotenv";
config();
import mongoose from "mongoose";

export const MONGO_URI = process.env.URI;

export const mongoconnect = async () => {
    await mongoose.connect(MONGO_URI).then(() => console.log("connect")).catch(() => console.log("Error"));
};
