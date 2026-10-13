import { loadLocalSettings, saveLocalSettings } from "./store.js";
import {
  WHITEBOARD_URL,
  cleanRoomId,
  iceServers,
  newRoomCode,
  normalizeTurn,
  iosDevice,
  screenShareAvailable,
} from "./roomlink.js";
import { copyText } from "./util.js";

const $ = (id) => document.getElementById(id);

const roomId = ensureRoomId();
const canShare = screenShareAvailable(navigator);
let myName = loadName();
let peer = null;
let role = "";
let localStream = null;
let screenStream = null;
let audioCtx = null;
let stopping = false;
let retryTimer = 0;
let retryDelay = 1500;
let warnedSize = false;
const peers = new Map();
const tiles = new Map();

function ensureRoomId() {
  const current = cleanRoomId(new URLSearchParams(location.search).get("id"));
  if (current) return current;
  const created = newRoomCode();
  const url = new URL(location.href);
  url.searchParams.set("id", created);
  history.replaceState(null, "", url);
  return created;
}

function loadName() {
  try { return localStorage.getItem("axiom.calendar.roomName") || ""; } catch { return ""; }
}

function saveName(name) {
  try { localStorage.setItem("axiom.calendar.roomName", name); } catch { /* private mode */ }
}

function peerOptions() {
  return { debug: 0, config: { iceServers: iceServers(loadLocalSettings().turn) } };
}

function inviteUrl() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("id", roomId);
  return url.href;
}

function toast(message) {
  const el = $("toast");
  el.hidden = false;
  el.textContent = message;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2800);
}

function setStatus(text) {
  const el = $("call-status");
  if (el) el.textContent = text;
}

function statusLine() {
  const others = [...peers.values()].filter((s) => s.remoteStream || s.heard).length;
  const n = 1 + others;
  const who = role === "host" ? "You opened the room. Keep this tab open." : "Connected.";
  return `${who} ${n} ${n === 1 ? "person" : "people"} here.`;
}

function upsert(id, patch) {
  const slot = peers.get(id) || { name: "Guest" };
  Object.assign(slot, patch);
  peers.set(id, slot);
  return slot;
}

function outgoingStream() {
  const stream = new MediaStream();
  const video = screenStream?.getVideoTracks?.()[0] || localStream?.getVideoTracks?.()[0];
  const audio = localStream?.getAudioTracks?.()[0];
  if (video && video.readyState !== "ended") stream.addTrack(video);
  if (audio && audio.readyState !== "ended") stream.addTrack(audio);
  return stream;
}

function silentStream() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return new MediaStream();
  audioCtx = audioCtx || new Ctx();
  const dest = audioCtx.createMediaStreamDestination();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  osc.start();
  audioCtx.resume?.();
  return dest.stream;
}

async function capture(withCamera) {
  if (!withCamera || !navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera and mic are off. Chat still works.");
    return silentStream();
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch {
    try {
      setStatus("Camera is blocked. Mic and chat still work.");
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setStatus("Camera and mic are blocked. Chat still works.");
      return silentStream();
    }
  }
}

function sendData(slot, msg) {
  const conn = slot?.data;
  if (!conn?.open) return;
  try { conn.send(msg); } catch { /* closed mid-send */ }
}

function rosterFor(skipId) {
  const list = [{ id: peer.id, name: myName, host: role === "host" }];
  for (const [id, slot] of peers) list.push({ id, name: slot.name || "Guest", host: !!slot.host });
  return list.filter((p) => p.id && p.id !== skipId);
}

function broadcastRoster() {
  for (const [id, slot] of peers) sendData(slot, { t: "roster", peers: rosterFor(id) });
  if (peers.size >= 3 && !warnedSize) {
    warnedSize = true;
    setStatus("This room is peer-to-peer and works best for 1:1. A bigger group may stutter.");
  }
}

function applyRoster(list) {
  for (const person of list) {
    if (!person?.id || person.id === peer?.id) continue;
    upsert(person.id, { name: String(person.name || "Guest").slice(0, 80), host: !!person.host });
    ensureMedia(person.id);
  }
  render();
}

function onMessage(fromId, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "hello" && role === "host") {
    const slot = upsert(fromId, { name: String(msg.name || "Guest").slice(0, 80), heard: true });
    slot.name = String(msg.name || slot.name || "Guest").slice(0, 80);
    broadcastRoster();
    ensureMedia(fromId);
    render();
    setStatus(statusLine());
    return;
  }
  if (msg.t === "roster" && Array.isArray(msg.peers)) {
    const slot = peers.get(fromId);
    if (slot) slot.heard = true;
    applyRoster(msg.peers);
    setStatus(statusLine());
    return;
  }
  if (msg.t === "chat" && typeof msg.text === "string") {
    appendChat(msg);
    if (role === "host") {
      for (const [id, slot] of peers) {
        if (id === msg.from) continue;
        sendData(slot, msg);
      }
    }
  }
}

function watchData(id, conn) {
  const slot = upsert(id, { data: conn, name: conn.metadata?.name || peers.get(id)?.name || "Guest" });
  conn.on("data", (msg) => onMessage(id, msg));
  const lost = () => {
    if (slot.data === conn) slot.data = null;
    if (slot.host || id === roomId) onHostLost();
    else render();
  };
  conn.on("close", lost);
  conn.on("error", lost);
  return slot;
}

function bindCall(id, call) {
  const slot = upsert(id, { media: call, name: call.metadata?.name || peers.get(id)?.name || "Guest" });
  clearTimeout(slot.waitTimer);
    call.on("stream", (remote) => {
    const current = peers.get(id);
    if (!current) return;
    current.remoteStream = remote;
    current.heard = true;
    render();
    setStatus(statusLine());
  });
  const gone = () => {
    const current = peers.get(id);
    if (!current || current.media !== call) return;
    current.media = null;
    current.remoteStream = null;
    render();
    if (!stopping) scheduleRecall(id);
  };
  call.on("close", gone);
  call.on("error", gone);
  const watchIce = () => {
    const pc = call.peerConnection;
    if (!pc) {
      setTimeout(watchIce, 300);
      return;
    }
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed") {
        setStatus("The call can’t get through this network. Add a TURN relay on the join screen, then reconnect.");
      }
    });
  };
  watchIce();
}

function placeCall(id) {
  const slot = peers.get(id);
  if (!slot || slot.media || !peer || peer.destroyed || peer.disconnected) return;
  const call = peer.call(id, outgoingStream(), { metadata: { kind: "camera", name: myName } });
  if (!call) return;
  slot.media = call;
  bindCall(id, call);
}

function ensureMedia(id) {
  const slot = peers.get(id);
  if (!slot || slot.media || !peer?.id) return;
  clearTimeout(slot.waitTimer);
  if (peer.id < id) placeCall(id);
  else slot.waitTimer = setTimeout(() => placeCall(id), 5000);
}

function scheduleRecall(id) {
  const slot = peers.get(id);
  if (!slot || stopping) return;
  clearTimeout(slot.recallTimer);
  slot.recallTimer = setTimeout(() => ensureMedia(id), 1200);
}

function wirePeer(next, asHost) {
  peer = next;
  if (asHost) role = "host";
  next.on("open", () => {
    if (peer !== next) return;
    retryDelay = 1500;
    role = asHost ? "host" : "guest";
    setStatus(asHost ? "You opened the room. Keep this tab open." : "Joining…");
    if (!asHost) connectHost();
    render();
  });
  next.on("connection", (conn) => {
    if (peer !== next) return;
    const slot = watchData(conn.peer, conn);
    conn.on("open", () => {
      if (role !== "host") return;
      sendData(slot, { t: "roster", peers: rosterFor(conn.peer) });
      broadcastRoster();
      ensureMedia(conn.peer);
      render();
    });
  });
  next.on("call", (call) => {
    if (peer !== next) return;
    const slot = upsert(call.peer, { name: call.metadata?.name || "Guest" });
    clearTimeout(slot.waitTimer);
    if (slot.media && slot.remoteStream) {
      try { call.close(); } catch { /* already gone */ }
      return;
    }
    slot.media = call;
    try { call.answer(outgoingStream()); } catch { /* stream ended */ }
    bindCall(call.peer, call);
  });
  next.on("disconnected", () => {
    if (peer !== next || stopping) return;
    setStatus("Reconnecting… people already in the call may stay connected.");
    setTimeout(() => {
      if (peer === next && !next.destroyed && next.disconnected) {
        try { next.reconnect(); } catch { rebuild(); }
      }
    }, 1500);
  });
  next.on("error", (err) => {
    if (peer !== next) return;
    const type = err?.type || "";
    if (asHost && type === "unavailable-id") {
      peer = null;
      let started = false;
      const becomeGuest = () => {
        if (started || stopping || peer) return;
        started = true;
        startGuest();
      };
      next.once?.("close", becomeGuest);
      try { next.destroy(); } catch { becomeGuest(); }
      setTimeout(becomeGuest, 500);
      return;
    }
    if (type === "peer-unavailable") {
      setStatus("The host tab isn’t open. Ask them to reopen this link, then tap Reconnect.");
      scheduleRebuild();
      return;
    }
    if (["network", "server-error", "socket-error", "socket-closed", "disconnected"].includes(type)) {
      setStatus("Can’t reach the room service. Retrying…");
      scheduleRebuild();
      return;
    }
    if (type === "browser-incompatible") {
      setStatus("This browser can’t join the video room. Try Safari or Chrome.");
    }
  });
}

function connectHost() {
  const conn = peer.connect(roomId, {
    reliable: true,
    serialization: "json",
    metadata: { name: myName },
  });
  if (!conn) {
    scheduleRebuild();
    return;
  }
  const slot = watchData(roomId, conn);
  slot.host = true;
  conn.on("open", () => {
    sendData(slot, { t: "hello", name: myName });
    ensureMedia(roomId);
    setStatus(statusLine());
  });
}

function startHost() {
  if (typeof Peer === "undefined") {
    setStatus("The video library didn’t load. Check the network and reload.");
    return;
  }
  wirePeer(new Peer(roomId, peerOptions()), true);
}

function startGuest() {
  if (typeof Peer === "undefined") {
    setStatus("The video library didn’t load. Check the network and reload.");
    return;
  }
  role = "guest";
  wirePeer(new Peer(peerOptions()), false);
}

function clearPeers() {
  for (const slot of peers.values()) {
    clearTimeout(slot.waitTimer);
    clearTimeout(slot.recallTimer);
    try { slot.media?.close(); } catch { /* ignore */ }
    try { slot.data?.close(); } catch { /* ignore */ }
  }
  peers.clear();
}

function rebuild() {
  if (stopping) return;
  const old = peer;
  peer = null;
  clearPeers();
  try { old?.destroy(); } catch { /* ignore */ }
  startHost();
}

function scheduleRebuild() {
  if (retryTimer || stopping) return;
  const wait = retryDelay;
  retryDelay = Math.min(10000, Math.round(retryDelay * 1.6));
  retryTimer = setTimeout(() => {
    retryTimer = 0;
    if (stopping) return;
    if (!peer || peer.destroyed) rebuild();
    else if (peer.disconnected) {
      try { peer.reconnect(); } catch { rebuild(); }
    } else if (role === "guest" && ![...peers.values()].some((s) => s.host && s.data?.open)) connectHost();
  }, wait);
}

function onHostLost() {
  if (stopping || role === "host") return;
  setStatus("The host tab closed or the connection dropped. Reconnecting…");
  scheduleRebuild();
}

function render() {
  const stage = $("stage");
  const wanted = new Set(["local"]);
  ensureTile("local", `${myName || "You"} (you)`, localPreview());
  for (const [id, slot] of peers) {
    if (!slot.remoteStream) continue;
    wanted.add(id);
    ensureTile(id, slot.name || "Guest", slot.remoteStream);
  }
  for (const [id, tile] of tiles) {
    if (wanted.has(id)) continue;
    tile.tile.remove();
    tiles.delete(id);
  }
  stage.querySelector(".tile.local")?.classList.toggle("sharing", !!screenStream);
}

function localPreview() {
  if (screenStream) return screenStream;
  return localStream;
}

function ensureTile(id, label, stream) {
  let tile = tiles.get(id);
  if (!tile) {
    const fig = document.createElement("figure");
    fig.className = id === "local" ? "tile local" : "tile";
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = id === "local";
    const cap = document.createElement("figcaption");
    fig.append(video, cap);
    $("stage").append(fig);
    tile = { tile: fig, video, cap, stream: null };
    tiles.set(id, tile);
  }
  tile.cap.textContent = label;
  if (stream && tile.stream !== stream) {
    tile.stream = stream;
    tile.video.srcObject = stream;
  }
  return tile;
}

function appendChat(msg) {
  const li = document.createElement("li");
  const who = document.createElement("strong");
  who.textContent = String(msg.name || "Guest").slice(0, 80);
  const body = document.createElement("span");
  body.textContent = String(msg.text || "").slice(0, 2000);
  li.append(who, body);
  const log = $("chat-log");
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

function sendChat(text) {
  const clean = text.trim().slice(0, 2000);
  if (!clean || !peer?.id) return false;
  const msg = { t: "chat", name: myName || "Guest", text: clean, at: Date.now(), from: peer.id };
  appendChat(msg);
  if (role === "host") {
    for (const slot of peers.values()) sendData(slot, msg);
  } else {
    sendData([...peers.values()].find((s) => s.host), msg);
  }
  return true;
}

function replaceOutgoingVideo(track) {
  for (const slot of peers.values()) {
    const pc = slot.media?.peerConnection;
    const sender = pc?.getSenders?.().find((s) => s.track?.kind === "video");
    if (sender) sender.replaceTrack(track).catch(() => {});
  }
}

async function toggleScreen() {
  if (!canShare) return;
  if (screenStream) {
    for (const track of screenStream.getTracks()) track.stop();
    screenStream = null;
    replaceOutgoingVideo(localStream?.getVideoTracks?.()[0] || null);
    $("share-screen").textContent = "Share screen";
    render();
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return;
  }
  const track = screenStream.getVideoTracks()[0];
  track.addEventListener("ended", () => { if (screenStream) toggleScreen(); });
  replaceOutgoingVideo(track);
  $("share-screen").textContent = "Stop sharing";
  render();
}

function toggleTrack(kind, button, onLabel, offLabel) {
  const track = localStream?.getTracks?.().find((t) => t.kind === kind);
  if (!track) {
    toast(kind === "audio" ? "No mic on this join" : "No camera on this join");
    return;
  }
  track.enabled = !track.enabled;
  button.textContent = track.enabled ? onLabel : offLabel;
  button.setAttribute("aria-pressed", track.enabled ? "false" : "true");
}

async function join(withCamera) {
  myName = ($("room-name").value || "Guest").trim().slice(0, 80) || "Guest";
  saveName(myName);
  $("join-cam").disabled = true;
  $("join-chat").disabled = true;
  localStream = await capture(withCamera);
  $("lobby").hidden = true;
  $("call").hidden = false;
  $("share-screen").hidden = !canShare;
  $("open-board").href = WHITEBOARD_URL;
  render();
  startHost();
}

function leave() {
  stopping = true;
  clearTimeout(retryTimer);
  for (const track of localStream?.getTracks?.() || []) track.stop();
  for (const track of screenStream?.getTracks?.() || []) track.stop();
  try { audioCtx?.close(); } catch { /* ignore */ }
  clearPeers();
  try { peer?.destroy(); } catch { /* ignore */ }
  peer = null;
  location.href = "./";
}

function fillTurn() {
  const turn = normalizeTurn(loadLocalSettings().turn);
  $("turn-urls").value = turn.urls;
  $("turn-user").value = turn.username;
  $("turn-cred").value = turn.credential;
}

function saveTurn() {
  const settings = loadLocalSettings();
  settings.turn = normalizeTurn({
    urls: $("turn-urls").value,
    username: $("turn-user").value,
    credential: $("turn-cred").value,
  });
  settings.updated = new Date().toISOString();
  saveLocalSettings(settings);
  toast(settings.turn.urls ? "Relay saved in this browser" : "Relay cleared. STUN only.");
}

function boot() {
  $("lobby-code").textContent = roomId;
  $("call-title").textContent = roomId;
  $("room-name").value = myName;
  $("ios-note").hidden = !iosDevice(navigator);
  fillTurn();
  $("join-cam").addEventListener("click", () => join(true));
  $("join-chat").addEventListener("click", () => join(false));
  $("turn-save").addEventListener("click", saveTurn);
  $("copy-invite").addEventListener("click", () => {
    copyText(inviteUrl()).then((ok) => toast(ok ? "Invite link copied" : "Couldn’t copy"));
  });
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (sendChat($("chat-input").value)) $("chat-input").value = "";
    else toast("Still connecting. Send again in a second.");
  });
  $("mute-mic").addEventListener("click", () => toggleTrack("audio", $("mute-mic"), "Mute mic", "Unmute mic"));
  $("mute-cam").addEventListener("click", () => toggleTrack("video", $("mute-cam"), "Stop camera", "Start camera"));
  $("share-screen").addEventListener("click", toggleScreen);
  $("reconnect").addEventListener("click", () => { retryDelay = 1500; rebuild(); setStatus("Reconnecting…"); });
  $("leave").addEventListener("click", leave);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
