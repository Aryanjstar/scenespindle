# SceneSpindle: one image, two roles (web and worker). See HANDOFF.md.
# Built on Debian so Chrome's headless shell and FFmpeg have their shared libraries.
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 DO_NOT_TRACK=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates fonts-liberation fonts-noto-core \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Local speech-to-text for reel captions and karaoke timing (used when ElevenLabs is unavailable).
# Pinned whisper.cpp release, built static so the runtime image needs no extra libraries.
FROM debian:bookworm-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git build-essential cmake curl \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.8.4 https://github.com/ggml-org/whisper.cpp.git /src \
    && cmake -S /src -B /src/build -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /src/build -j --target whisper-cli \
    && install -m 0755 /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
# Multilingual base model (MIT, ggml format) so Hindi and English both work.
RUN mkdir -p /opt/whisper && curl -fsSL -o /opt/whisper/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS run
ENV NODE_ENV=production STORAGE_DIR=/data/media VOICE_CACHE_DIR=/data/cache/voice RENDER_WORK_DIR=/data/work \
    WHISPER_CLI=/usr/local/bin/whisper-cli WHISPER_MODEL=/opt/whisper/ggml-base.bin
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /opt/whisper /opt/whisper
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown -R node:node /data
# Chrome is cached per user, so download it as the user that renders.
USER node
# Download the pinned renderer's headless Chrome into the image, then prove the
# whole film pipeline works with the local test tone (no keys, no network calls), including the
# WebGL 3D stage: a black stage frame fails the build.
RUN whisper-cli --help > /dev/null \
 && ffmpeg -v error -f lavfi -i "sine=f=440:d=2" -ar 16000 -ac 1 /tmp/tone.wav \
 && whisper-cli -m "$WHISPER_MODEL" -f /tmp/tone.wav -ml 1 -sow -oj -of /tmp/tone -np > /dev/null && test -s /tmp/tone.json && rm -f /tmp/tone.*
RUN npx hyperframes browser ensure \
 && SCENESPINDLE_TEST_VOICE=1 STORAGE_DIR=/tmp/smoke VOICE_CACHE_DIR=/tmp/smoke/cache \
    npm run --silent studio -- render examples/plans/why-ice-floats.json --voice test:tone --out /tmp/smoke/out > /tmp/smoke.json \
 && (grep -q '"ready": true' /tmp/smoke.json || (cat /tmp/smoke.json; exit 1)) \
 && SCENESPINDLE_TEST_VOICE=1 STORAGE_DIR=/tmp/smoke VOICE_CACHE_DIR=/tmp/smoke/cache \
    npm run --silent studio -- render examples/plans/story-stage-offline.json --voice test:tone --out /tmp/smoke/story > /tmp/story.json \
 && (grep -q '"ready": true' /tmp/story.json || (cat /tmp/story.json; exit 1)) \
 && Y=$(ffmpeg -ss 2 -i /tmp/smoke/story/film.mp4 -frames:v 1 -vf signalstats,metadata=print:key=lavfi.signalstats.YAVG -f null - 2>&1 | grep -o 'YAVG=[0-9]*' | head -1 | cut -d= -f2) \
 && echo "3D stage brightness: $Y" && [ "${Y:-0}" -gt 25 ] \
 && rm -rf /tmp/smoke /tmp/smoke.json /tmp/story.json
VOLUME ["/data"]
EXPOSE 3000
# Default role is the web app. Run the worker with: command ["npm", "run", "worker:prod"]
CMD ["npm", "run", "start:prod"]
