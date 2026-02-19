import mongoose from "mongoose";

export const mongoconnect = async () => {
    await mongoose.connect(process.env.URI).then(() => console.log("connect")).catch(() => console.log("Error"));
}