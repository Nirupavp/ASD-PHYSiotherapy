"use strict";

/**
 * Small, dependency-free HTTP API for MotionIQ.  Data is stored on disk so it
 * is shared by every browser using this deployment (unlike localStorage).
 */
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "motioniq.json");
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const EMPTY_DATA = () => ({ exercises: [], childProfile: null, yogaConfig: null, yogaSessions: [], exerciseSessions: [] });

let database = EMPTY_DATA();
let writeQueue = Promise.resolve();

async function loadDatabase() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    database = { ...EMPTY_DATA(), ...parsed };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await persist();
  }
}

function persist() {
  writeQueue = writeQueue.then(async () => {
    const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(database, null, 2));
    await fs.rename(temporaryFile, DATA_FILE);
  });
  return writeQueue;
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("Request body is too large");
  }
  try { return JSON.parse(body || "{}"); } catch { throw new Error("Request body must be valid JSON"); }
}

function cleanText(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validExercise(input) {
  const name = cleanText(input.name);
  if (!name) return null;
  return {
    ...input,
    id: cleanText(input.id, 100) || crypto.randomUUID(),
    name,
    category: cleanText(input.category, 50) || "Strength",
    joints: Array.isArray(input.joints) ? input.joints.filter(joint => typeof joint === "string").slice(0, 8) : [],
    videoDataUrl: typeof input.videoDataUrl === "string" && input.videoDataUrl.length <= 9_000_000 ? input.videoDataUrl : null,
  };
}

function staticFile(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  if (!new Set(["/index.html", "/app.js", "/exercises.js", "/pose-engine.js", "/styles.css"]).has(requested)) return null;
  const file = path.resolve(ROOT, `.${requested}`);
  return file.startsWith(`${ROOT}${path.sep}`) ? file : null;
}

async function handleApi(request, response, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const resource = segments[1];
  const id = segments[2];
  if (request.method === "GET" && resource === "health") return send(response, 200, { ok: true });
  if (resource === "exercises") {
    if (request.method === "GET") return send(response, 200, database.exercises);
    if (request.method === "POST") {
      const exercise = validExercise(await readJson(request));
      if (!exercise) return send(response, 400, { error: "Exercise name is required." });
      database.exercises.push(exercise); await persist(); return send(response, 201, exercise);
    }
    if (request.method === "DELETE" && id) {
      const before = database.exercises.length;
      database.exercises = database.exercises.filter(exercise => exercise.id !== id);
      if (before === database.exercises.length) return send(response, 404, { error: "Exercise not found." });
      await persist(); return send(response, 204, {});
    }
  }
  const property = resource === "child-profile" ? "childProfile" : resource === "yoga-config" ? "yogaConfig" : null;
  if (property) {
    if (request.method === "GET") return send(response, 200, database[property]);
    if (request.method === "PUT") { database[property] = await readJson(request); await persist(); return send(response, 200, database[property]); }
  }
  const sessionProperty = resource === "yoga-sessions" ? "yogaSessions" : resource === "exercise-sessions" ? "exerciseSessions" : null;
  if (sessionProperty) {
    if (request.method === "GET") {
      const user = url.searchParams.get("user");
      return send(response, 200, user ? database[sessionProperty].filter(session => session.userName === user) : database[sessionProperty]);
    }
    if (request.method === "POST") {
      const session = await readJson(request);
      session.id = cleanText(session.id, 100) || crypto.randomUUID();
      session.userName = cleanText(session.userName, 100) || "Unknown";
      session.date = new Date().toISOString();
      database[sessionProperty].push(session); await persist(); return send(response, 201, session);
    }
  }
  send(response, 404, { error: "API endpoint not found." });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, { error: "Method not allowed." });
    const file = staticFile(decodeURIComponent(url.pathname));
    if (!file) return send(response, 403, { error: "Forbidden." });
    const content = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    const status = error.message === "Request body is too large" ? 413 : error.message === "Request body must be valid JSON" ? 400 : error.code === "ENOENT" ? 404 : 500;
    send(response, status, { error: status === 500 ? "Internal server error." : error.message || "Not found." });
  }
});

loadDatabase().then(() => server.listen(PORT, () => console.log(`MotionIQ server listening on http://localhost:${PORT}`))).catch(error => { console.error(error); process.exit(1); });
