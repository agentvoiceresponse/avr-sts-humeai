/**
 * index.js
 * Entry point for the Hume EVI (Empathic Voice Interface) Speech-to-Speech streaming application.
 * This server handles real-time audio streaming between clients and Hume's API,
 * performing necessary audio format conversions and WebSocket communication.
 *
 * @author Agent Voice Response <info@agentvoiceresponse.com>
 * @see https://www.agentvoiceresponse.com
 */

import { WebSocket, WebSocketServer } from "ws";
import dotenv from "dotenv";
import { HumeClient } from "hume";
// import { AudioResampler } from "avr-resampler";
import { ChatSocket } from "hume/dist/cjs/api/resources/empathicVoice/resources/chat";
import { parseWav } from "./lib";
dotenv.config();

// Provider sample rate - Hume expects 48kHz input
// The AudioResampler handles: 8kHz (client) <-> 48kHz (Hume)
// const HUME_SAMPLE_RATE = 48000;
// const resampler = new AudioResampler(HUME_SAMPLE_RATE);

const client = new HumeClient({
  apiKey: process.env.HUME_API_KEY!, // Load from environment variables
});

const initializeHumeConnection = async (clientWs: WebSocket) => {
  const humeSocket = await client.empathicVoice.chat.connect({
    configId: process.env.HUME_CONFIG_ID, // optional
  });

  humeSocket.on("open", () => {
    console.log("Hume connection opened");

    // Send session settings to configure audio format
    // This tells Hume we're sending 48kHz linear16 PCM audio
    humeSocket.sendSessionSettings({
      audio: {
        encoding: "linear16",
        channels: 1,
        sampleRate: 8000,
      },
    });
    console.log(`Session settings sent: 8000Hz, linear16, mono`);
  });

  humeSocket.on("message", (msg: any) => {
    // Log non-audio messages for debugging
    if (msg.type !== "audio_output") {
      console.log("Received message from Hume:", JSON.stringify(msg));
    }

    // Handle error messages from Hume
    if (msg.type === "error") {
      console.error("Error from Hume API:", msg);
      return;
    }

    if (msg.type === "audio_output") {
      try {
        // Decode base64 audio data
        const providerAudio = Buffer.from(msg.data, "base64");

        // Parse WAV to get actual sample rate and PCM data
        const wavInfo = parseWav(providerAudio);
        if (!wavInfo) {
          console.error("Failed to parse WAV from Hume");
          return;
        }

        // Log actual output sample rate (only once for debugging)
        if (wavInfo.sampleRate !== 8000) {
          console.warn(
            `Hume output sample rate (${wavInfo.sampleRate}Hz) differs from expected (8000Hz)`
          );
        }

        // Downsample from Hume's sample rate to client's 8kHz
        // const clientAudio = resampler.downsample(wavInfo.pcmData);

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "audio",
              audio: wavInfo.pcmData.toString("base64"),
            })
          );
        }
      } catch (error) {
        console.error("Error processing audio from Hume:", error);
      }
    }
  });
  humeSocket.on("error", (error: any) => {
    console.error("Error from Hume WebSocket:", error);
  });
  humeSocket.on("close", (event: any) => {
    console.log("Hume connection closed:", {
      code: event?.code,
      reason: event?.reason,
      wasClean: event?.wasClean,
    });
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });
  return humeSocket;
};

const handleClientConnection = (clientWs: WebSocket) => {
  console.log("New client WebSocket connection received");
  let humeSocket: ChatSocket | null = null;
  const queued: { audio: string }[] = []; // Queue for messages to be sent to Hume

  /**
   * Calculate optimal chunk size for audio streaming to Hume
   * Hume recommends 100ms chunks for web applications
   * Formula: sampleRate * channels * bytesPerSample * timeWindow
   * 48000 Hz * 1 channel * 2 bytes (16-bit PCM) * 0.1 seconds = 9600 bytes
   */
  const CHUNK_SIZE = 9600; // 100ms of 48kHz 16-bit mono PCM audio

  /**
   * Send audio to Hume in optimal chunks
   */
  const sendAudioInChunks = (audioBuffer: Buffer) => {
    if (!humeSocket || humeSocket.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send audio: Hume socket not ready");
      return;
    }

    try {
      const bufferLength = audioBuffer.length;

      // If audio is smaller than chunk size, send it all at once
      if (bufferLength <= CHUNK_SIZE) {
        humeSocket.sendAudioInput({
          data: audioBuffer.toString("base64"),
        });
        return;
      }

      // Split audio into chunks and send sequentially
      // Use subarray() to create views without copying memory
      for (let offset = 0; offset < bufferLength; offset += CHUNK_SIZE) {
        humeSocket.sendAudioInput({
          data: audioBuffer
            .subarray(offset, offset + CHUNK_SIZE)
            .toString("base64"),
        });
      }
    } catch (error) {
      console.error("Error sending audio chunks to Hume:", error);
    }
  };

  // Function to send all queued messages when socket is ready
  const flushQueue = () => {
    if (!humeSocket || humeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const queueLength = queued.length;
    if (queueLength === 0) {
      return;
    }

    try {
      for (let i = 0; i < queueLength; i++) {
        // Upsample from client's 8000 Hz to Hume's 48000 Hz
        const clientAudio = Buffer.from(queued[i].audio, "base64");
        // const providerAudio = resampler.upsample(clientAudio);

        // Send audio in optimal chunks (100ms)
        sendAudioInChunks(clientAudio);
      }
      // Clear the queue after sending
      queued.length = 0;
    } catch (error) {
      console.error("Error flushing audio queue:", error);
    }
  };

  // Communication from Asterisk to Hume
  clientWs.on("message", async (data: any) => {
    try {
      const message = JSON.parse(data);
      switch (message.type) {
        case "audio":
          // Add message to queue
          queued.push({ audio: message.audio });

          // Try to send queued messages if socket is ready
          flushQueue();
          break;

        case "init":
          console.log("Received init message from client", data);
          humeSocket = await initializeHumeConnection(clientWs);

          // When socket is ready, flush any queued messages
          if (humeSocket && humeSocket.readyState === WebSocket.OPEN) {
            flushQueue();
          }
          break;
      }
    } catch (error) {
      console.error("Error processing message from client:", error);
      clientWs.close();
    }
  });

  clientWs.on("close", () => {
    console.log("Client WebSocket connection closed");
    if (humeSocket && humeSocket.readyState === WebSocket.OPEN) {
      humeSocket.close();
    }
  });
};

// Handle process termination signals
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Initialize and start server
const startServer = async () => {
  try {
    // await resampler.initialize();

    // Create WebSocket server
    const PORT = process.env.PORT || 6035;
    const wss = new WebSocketServer({ port: Number(PORT) });
    console.log(`Server is running on port ${Number(PORT)}`);
    wss.on("connection", (clientWs: WebSocket) => {
      console.log("New client connected");
      handleClientConnection(clientWs);
    });

    wss.on("error", (error: Error) => {
      console.error("WebSocket server error:", error);
    });

    wss.on("listening", () => {
      console.log("WebSocket server is listening");
    });

    wss.on("close", () => {
      console.log("WebSocket server closed");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
