import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Admin from "../models/Admin.js";
import { hashPassword } from "../middleware/adminAuth.js";

const promptHidden = (prompt) => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    reject(new Error("Run this command in an interactive terminal so the password can be entered safely."));
    return;
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  const cleanup = () => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.removeListener("data", onData);
  };
  const onData = (chunk) => {
    for (const character of chunk.toString("utf8")) {
      if (character === "\u0003") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Admin creation cancelled."));
        return;
      }
      if (character === "\r" || character === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
        continue;
      }
      if (character >= " ") value += character;
    }
  };
  stdin.on("data", onData);
});

const main = async () => {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const email = (await terminal.question("Admin email: ")).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid admin email address.");
    }
    terminal.close();

    const password = await promptHidden("Admin password (minimum 12 characters): ");
    if (password.length < 12 || password.length > 1024) {
      throw new Error("Admin password must contain between 12 and 1024 characters.");
    }
    const confirmation = await promptHidden("Confirm admin password: ");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    await connectDB();
    await Admin.init();
    if (await Admin.exists({ email })) {
      throw new Error("An admin account with this email already exists. No changes were made.");
    }

    await Admin.create({ email, passwordHash: await hashPassword(password), bootstrapAccount: "initial" });
    console.log(`Admin account created for ${email}.`);
  } finally {
    terminal.close();
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
