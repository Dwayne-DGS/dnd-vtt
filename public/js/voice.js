// Voice + video chat via a WebRTC mesh. Every participant connects directly to
// every other participant; the server is used only to exchange connection info
// (signaling). Good for a small table (~2-5 people).
//
// IMPORTANT: browsers only allow microphone/camera on a SECURE origin —
// https:// or http://localhost. Over plain http://<server-ip> the browser will
// refuse getUserMedia. Set up HTTPS (see README) for voice to work in the wild.

export function initVoice(socket) {
  // Public STUN server helps peers discover each other across home routers.
  // If some players still can't connect, a TURN relay server is the next step.
  const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  let localStream = null;
  const pcs = new Map(); // peerId -> RTCPeerConnection

  const strip = document.getElementById("video-strip");
  const joinBtn = document.getElementById("voice-join");
  const muteBtn = document.getElementById("voice-mute");
  const camBtn = document.getElementById("voice-cam");
  const leaveBtn = document.getElementById("voice-leave");

  function tile(id, label) {
    let t = document.getElementById("tile-" + id);
    if (!t) {
      t = document.createElement("div");
      t.id = "tile-" + id;
      t.className = "vtile";
      t.innerHTML =
        `<video autoplay playsinline ${id === "self" ? "muted" : ""}></video>` +
        `<span class="vname">${label}</span>`;
      strip.appendChild(t);
    }
    return t;
  }
  function removeTile(id) {
    const t = document.getElementById("tile-" + id);
    if (t) t.remove();
  }

  async function join() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (e1) {
      // No camera? Fall back to audio only.
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        alert(
          "Couldn't access your mic/camera.\n\n" +
            "If you're on http://<ip> this is expected — browsers require HTTPS " +
            "for voice/video. See the HTTPS setup steps.\n\n(" + e2.message + ")"
        );
        return;
      }
    }
    tile("self", "You").querySelector("video").srcObject = localStream;
    setInCall(true);
    socket.emit("voiceJoin");
  }

  function createPC(peerId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcs.set(peerId, pc);
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("voiceSignal", { to: peerId, signal: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      tile(peerId, "Player").querySelector("video").srcObject = e.streams[0];
    };
    return pc;
  }

  // We just joined: the server hands us everyone already in the call. We call them.
  socket.on("voicePeers", async (peers) => {
    for (const peerId of peers) {
      const pc = createPC(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("voiceSignal", { to: peerId, signal: { sdp: pc.localDescription } });
    }
  });

  // Relayed signaling from another peer.
  socket.on("voiceSignal", async ({ from, signal }) => {
    if (!localStream) return; // we're not in the call
    let pc = pcs.get(from);
    if (signal.sdp) {
      if (!pc) pc = createPC(from); // answering an incoming call
      await pc.setRemoteDescription(signal.sdp);
      if (signal.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voiceSignal", { to: from, signal: { sdp: pc.localDescription } });
      }
    } else if (signal.candidate && pc) {
      try { await pc.addIceCandidate(signal.candidate); } catch (_) {}
    }
  });

  socket.on("voicePeerLeft", (id) => {
    const pc = pcs.get(id);
    if (pc) pc.close();
    pcs.delete(id);
    removeTile(id);
  });

  function leave() {
    socket.emit("voiceLeave");
    pcs.forEach((pc) => pc.close());
    pcs.clear();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    strip.innerHTML = "";
    setInCall(false);
  }

  function toggleMute() {
    const a = localStream?.getAudioTracks()[0];
    if (!a) return;
    a.enabled = !a.enabled;
    muteBtn.textContent = a.enabled ? "🔇 Mute" : "🎤 Unmute";
    document.getElementById("tile-self")?.classList.toggle("muted-tile", !a.enabled);
  }
  function toggleCam() {
    const v = localStream?.getVideoTracks()[0];
    if (!v) return;
    v.enabled = !v.enabled;
    camBtn.textContent = v.enabled ? "📷 Cam off" : "📷 Cam on";
  }

  function setInCall(inCall) {
    joinBtn.classList.toggle("hidden", inCall);
    muteBtn.classList.toggle("hidden", !inCall);
    camBtn.classList.toggle("hidden", !inCall);
    leaveBtn.classList.toggle("hidden", !inCall);
    strip.classList.toggle("hidden", !inCall);
  }

  joinBtn.addEventListener("click", join);
  muteBtn.addEventListener("click", toggleMute);
  camBtn.addEventListener("click", toggleCam);
  leaveBtn.addEventListener("click", leave);
  window.addEventListener("beforeunload", () => { if (localStream) socket.emit("voiceLeave"); });
}
