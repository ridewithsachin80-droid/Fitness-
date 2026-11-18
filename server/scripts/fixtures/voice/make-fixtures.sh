#!/bin/bash
# Fixes-2u: makes the audio fixtures used by test-speech-presence.js and
# test-voice-phase2.js. Needs espeak-ng and ffmpeg (with libopus). The files are
# committed, so the tests do not need either tool; run this only to remake them.
# Computer voices stand in for speech here: they show that the check tells a
# voice from silence, noise and tones. They are not real member recordings.
set -euo pipefail
cd "$(dirname "$0")"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
say() { espeak-ng -v "$1" -s 140 -w "$T/$2.wav" "$3"; }
opus() { ffmpeg -y -loglevel error -i "$1" -ar 48000 -ac 1 -c:a libopus -b:a 24k "$2"; }
say en      en  "Two idli, one bowl sambar, weight eighty two point five kilograms."
say kn      kn  "ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ"
say hi      hi  "दो रोटी और एक कटोरी दाल खाई"
say en-us+f3 fem "Lunch was one plate rice and dal."
say en      mix "Aaj breakfast mein do idli aur one cup coffee liya."
say en      short "Do idli."
pad() { ffmpeg -y -loglevel error -i "$1" -af "adelay=500|500,apad=pad_dur=${3:-3}" -ar 48000 -ac 1 "$2"; }
pad "$T/en.wav" "$T/en-p.wav"; opus "$T/en-p.wav" speech-en.webm
pad "$T/kn.wav" "$T/kn-p.wav"; opus "$T/kn-p.wav" speech-kn.webm
pad "$T/hi.wav" "$T/hi-p.wav"; opus "$T/hi-p.wav" speech-hi.webm
pad "$T/fem.wav" "$T/fem-p.wav"; opus "$T/fem-p.wav" speech-female.webm
pad "$T/mix.wav" "$T/mix-p.wav"; opus "$T/mix-p.wav" speech-mixed.webm
pad "$T/short.wav" "$T/short-p.wav" 4; opus "$T/short-p.wav" speech-short.webm
# quiet speech (-30 dB) in a quiet room
ffmpeg -y -loglevel error -i "$T/en-p.wav" -af "volume=0.03" "$T/quiet.wav"; opus "$T/quiet.wav" speech-quiet.webm
# quiet speech over low background noise
ffmpeg -y -loglevel error -i "$T/en-p.wav" -f lavfi -i "anoisesrc=color=pink:amplitude=0.02:duration=12:seed=7" -filter_complex "[0]volume=0.1[v];[v][1]amix=inputs=2:duration=first:normalize=0" -ar 48000 -ac 1 "$T/qn.wav"; opus "$T/qn.wav" speech-quiet-noise.webm
# speech with background noise about as loud as the voice (a kitchen, a TV)
ffmpeg -y -loglevel error -i "$T/en.wav" -f lavfi -i "anoisesrc=color=pink:amplitude=0.06:duration=12:seed=7" -filter_complex "[0]volume=0.12,adelay=500|500,apad=pad_dur=3[v];[v][1]amix=inputs=2:duration=first:normalize=0" -ar 48000 -ac 1 "$T/eq.wav"; opus "$T/eq.wav" speech-noise-as-loud.webm
# the first real run's S5 recipe: speech at 0.12 under pink noise at 0.5
ffmpeg -y -loglevel error -i "$T/en.wav" -f lavfi -i "anoisesrc=color=pink:amplitude=0.5:duration=12:seed=7" -filter_complex "[0]volume=0.12,adelay=500|500,apad=pad_dur=4.5[v];[v][1]amix=inputs=2:duration=first:normalize=0" -ar 48000 -ac 1 "$T/s5.wav"; opus "$T/s5.wav" speech-under-loud-noise.webm
# no speech
ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=48000:cl=mono" -t 6 "$T/sil.wav"; opus "$T/sil.wav" silence-digital.webm
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=color=pink:amplitude=0.01:duration=6:seed=3" -ar 48000 -ac 1 "$T/room.wav"; opus "$T/room.wav" noise-room.webm
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=color=pink:amplitude=0.5:duration=6:seed=4" -ar 48000 -ac 1 "$T/loud.wav"; opus "$T/loud.wav" noise-loud-pink.webm
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=color=white:amplitude=0.2:duration=6:seed=5" -ar 48000 -ac 1 "$T/white.wav"; opus "$T/white.wav" noise-white.webm
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=50:duration=6" -f lavfi -i "sine=frequency=100:duration=6" -f lavfi -i "sine=frequency=150:duration=6" -filter_complex "[0][1][2]amix=inputs=3:normalize=0,volume=0.3" -ar 48000 -ac 1 "$T/hum.wav"; opus "$T/hum.wav" hum-mains.webm
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=300:duration=0.4" -af "apad=pad_dur=0.6" "$T/b1.wav"; ffmpeg -y -loglevel error -stream_loop 5 -i "$T/b1.wav" "$T/beeps.wav"; opus "$T/beeps.wav" tone-beeps.webm
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=color=brown:amplitude=0.8:duration=6:seed=12" -ar 48000 -ac 1 "$T/brown.wav"; opus "$T/brown.wav" noise-loud-rumble.webm
# iPhone-style recording: AAC in mp4
ffmpeg -y -loglevel error -i "$T/en-p.wav" -c:a aac -b:a 48k speech-en-iphone.m4a
ls -l
