import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import * as WavDecoder from "wav-decoder";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

async function downloadYoutubeAudioToFile(url: string, targetPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = ytdl(url, { quality: "highestaudio", filter: "audioonly" });
    const output = createWriteStream(targetPath);
    stream.on("error", reject);
    output.on("error", reject);
    output.on("finish", () => resolve());
    stream.pipe(output);
  });
}

async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary unavailable");
  }
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(22050)
      .format("wav")
      .on("end", () => resolve())
      .on("error", reject)
      .save(outputPath);
  });
}

export async function fetchYoutubePcm(url: string): Promise<{ sampleRate: number; channelData: Float32Array }> {
  const tempDir = path.join(os.tmpdir(), `spotifyhero-${randomUUID()}`);
  const inputPath = path.join(tempDir, "input.audio");
  const outputPath = path.join(tempDir, "output.wav");
  await fs.mkdir(tempDir, { recursive: true });
  try {
    await downloadYoutubeAudioToFile(url, inputPath);
    await convertToWav(inputPath, outputPath);
    const wavBuf = await fs.readFile(outputPath);
    const decoded = await WavDecoder.decode(wavBuf);
    const channelData = decoded.channelData[0] ?? new Float32Array(0);
    return { sampleRate: decoded.sampleRate, channelData };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

