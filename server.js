const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://pollingsystemlive.netlify.app",
    methods: ["GET", "POST"],
  },
});

const students = new Map();
let activePoll = null;
const pollHistory = [];

const broadcastStudents = () => {
  io.emit(
    "students-update",
    Array.from(students.entries()).map(([id, data]) => ({
      id,
      name: data.name,
    }))
  );
};

const startPoll = (pollData) => {
  activePoll = {
    question: pollData.question,
    options: pollData.options,
    timeLimit: pollData.time,
    timeLeft: pollData.time,
    startTime: new Date(),
    hasEnded: false,
    votes: new Map(),
  };

  activePoll.timer = setInterval(() => {
    activePoll.timeLeft--;
    io.emit("poll-update", { timeLeft: activePoll.timeLeft });

    if (activePoll.timeLeft <= 0) {
      endPoll();
    }
  }, 1000);

  io.emit("new-poll", {
    question: activePoll.question,
    options: activePoll.options,
    time: activePoll.timeLimit,
  });

  console.log("Poll started:", pollData.question);
};

const endPoll = () => {
  if (!activePoll || activePoll.hasEnded) return;

  clearInterval(activePoll.timer);
  activePoll.hasEnded = true;

  const results = new Array(activePoll.options.length).fill(0);
  for (const [_, optionIndex] of activePoll.votes.entries()) {
    results[optionIndex]++;
  }

  const completedPoll = {
    question: activePoll.question,
    options: activePoll.options,
    results,
    participants: students.size,
    votes: activePoll.votes.size,
    timestamp: new Date(),
  };

  pollHistory.push(completedPoll);
  io.emit("poll-ended", completedPoll);

  console.log(" Poll ended:", completedPoll.question);
};

io.on("connection", (socket) => {
  console.log(" New connection:", socket.id);

  socket.on("student-join", (name) => {
    students.set(socket.id, { name, joinedAt: new Date() });
    console.log(` Student joined: ${name} (${socket.id})`);
    broadcastStudents();

    if (activePoll && !activePoll.hasEnded) {
      socket.emit("new-poll", {
        question: activePoll.question,
        options: activePoll.options,
        time: activePoll.timeLeft,
      });
    }
  });

  socket.on("create-poll", (pollData) => {
    if (activePoll && !activePoll.hasEnded) {
      socket.emit("error", "A poll is already active");
      return;
    }
    startPoll(pollData);
  });

  socket.on("submit-answer", (optionIndex) => {
    if (
      !activePoll ||
      activePoll.hasEnded ||
      optionIndex < 0 ||
      optionIndex >= activePoll.options.length
    ) {
      return;
    }
    activePoll.votes.set(socket.id, optionIndex);
  });

  socket.on("end-poll", () => {
    endPoll();
  });

  socket.on("teacher-message", (message) => {
    io.emit("teacher-message", {
      text: message,
      sender: "Teacher",
      isTeacher: true,
    });
  });

  socket.on("student-message", (message) => {
    io.emit("student-message", {
      text: message.text,
      sender: message.sender,
      isTeacher: false,
    });
  });

  socket.on("kick-student", (studentId) => {
    if (students.has(studentId)) {
      activePoll?.votes.delete(studentId);
      io.to(studentId).emit("kicked");
      students.delete(studentId);
      broadcastStudents();
      console.log(`Student kicked: ${studentId}`);
    }
  });

  socket.on("get-history", () => {
    socket.emit("poll-history", [...pollHistory].reverse());
  });

  socket.on("disconnect", () => {
    if (students.has(socket.id)) {
      activePoll?.votes.delete(socket.id);
      students.delete(socket.id);
      broadcastStudents();
      console.log(`Student disconnected: ${socket.id}`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
