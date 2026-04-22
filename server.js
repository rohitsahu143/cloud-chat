
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* MongoDB Connection */
mongoose.connect("mongodb://127.0.0.1:27017/cloudchat");

mongoose.connection.on("connected", () => {
    console.log("MongoDB Connected");
});

/* Message Schema */
const MessageSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    text: String,
    time: String
});

const Message = mongoose.model("Message", MessageSchema);

/* Serve frontend */
app.use(express.static("public"));

/* Socket connection */
io.on("connection", (socket) => {

    console.log("User connected");

    /* Load old chat history */
    socket.on("load messages", async (users) => {

        try {

            const msgs = await Message.find({
                $or: [
                    { sender: users.me, receiver: users.friend },
                    { sender: users.friend, receiver: users.me }
                ]
            });

            socket.emit("chat history", msgs);

        } catch (err) {
            console.log("History load error:", err);
        }

    });

    /* Receive new message */
    socket.on("chat message", async (msg) => {

        try {

            const newMsg = new Message(msg);

            await newMsg.save();

            io.emit("chat message", msg);

        } catch (err) {
            console.log("DB Error:", err);
        }

    });

    socket.on("disconnect", () => {
        console.log("User disconnected");
    });

});

/* Start server */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);

});