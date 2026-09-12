import mongoose from "mongoose";

const User = await mongoose.Schema({
    userid : { type : String },
    lastImageGeneratedAt : { type : Date },
    messages : [
        {
            role : {type : String},
            content : {type : String}
        }
    ]
})

export default mongoose.model("User",User);