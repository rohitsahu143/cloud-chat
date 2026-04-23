
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const https = require("https");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/* ✅ Handle crashes gracefully — prevents server from dying */
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

/* ✅ MongoDB Connection with auto-reconnect */
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/cloudchat";

const connectDB = async () => {
  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    setTimeout(connectDB, 5000); // retry after 5 seconds
  }
};
connectDB();

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Reconnecting...");
  setTimeout(connectDB, 5000);
});

/* Message Schema */
const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  time: String,
});
const Message = mongoose.model("Message", MessageSchema);

/* ✅ Serve frontend */
app.use(express.static("public"));

/* ✅ Health check endpoint — required for keep-alive ping */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* ✅ Track connected users to avoid memory leak */
const connectedUsers = new Map();

/* Socket connection */
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.set(socket.id, { connectedAt: Date.now() });

  /* ✅ Load old chat history — with limit to avoid overload */
  socket.on("load messages", async (users) => {
    if (!users || !users.me || !users.friend) return;
    try {
      const msgs = await Message.find({
        $or: [
          { sender: users.me, receiver: users.friend },
          { sender: users.friend, receiver: users.me },
        ],
      })
        .sort({ _id: -1 })   // latest first
        .limit(100)           // ✅ only load last 100 messages
        .lean();              // ✅ faster, returns plain JS objects

      socket.emit("chat history", msgs.reverse());
    } catch (err) {
      console.error("History load error:", err.message);
      socket.emit("chat history", []);
    }
  });

  /* ✅ Receive and save new message */
  socket.on("chat message", async (msg) => {
    if (!msg || !msg.text || !msg.sender) return; // ✅ validate before saving

    try {
      const newMsg = new Message(msg);
      await newMsg.save();
    } catch (err) {
      console.error("DB save error:", err.message);
    }

    // ✅ Always broadcast even if DB save fails
    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    console.log(`User disconnected: ${socket.id}`);
  });
});

/* ✅ Keep-alive ping — prevents Render free tier from sleeping */
const RENDER_URL = process.env.RENDER_URL || "";
if (RENDER_URL) {
  setInterval(() => {
    https
      .get(`${RENDER_URL}/health`, (res) => {
        console.log(`Keep-alive ping sent ✅ status: ${res.statusCode}`);
      })
      .on("error", (err) => {
        console.error("Keep-alive ping failed:", err.message);
      });
  }, 14 * 60 * 1000); // every 14 minutes
}

/* Start server */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
