# Phonon worker for the sherpa trial engine (grimoire 646). Loads Phonon 31m
# English once and keeps it warm, like Kokoro in sherpa.mjs. One JSON line in
# per reply ({"text": ...}), one JSON line out ({"ok": true, "rate": n,
# "pcm": base64 16-bit mono} or {"ok": false}). Exits when stdin closes, so it
# ends with the listener. Offline: the model and voice come from the Hugging
# Face cache, fetched once by hand. Not reviewed; trial only.
import base64, json, os, sys

os.environ["HF_HUB_OFFLINE"] = "1"
import numpy as np
import ptts

voice = sys.argv[1] if len(sys.argv) > 1 else "Everly"
tts = ptts.TTS(lang="en")
tts.synth("Okay.", voice=voice)  # warm: the first call pays the voice load
out = sys.stdout
out.write(json.dumps({"ready": True, "rate": tts.sample_rate}) + "\n")
out.flush()

for line in sys.stdin:
    try:
        text = json.loads(line)["text"]
        a = tts.synth(text, voice=voice)
        pcm = (np.clip(a, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        reply = {"ok": True, "rate": tts.sample_rate, "pcm": base64.b64encode(pcm).decode("ascii")}
    except Exception:
        reply = {"ok": False}
    out.write(json.dumps(reply) + "\n")
    out.flush()
