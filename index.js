/**
 * index.js
 * Entry point for the HumeAI Speech-to-Speech streaming WebSocket server.
 * This server handles real-time audio streaming between clients and HumeAI's API,
 * performing necessary audio format conversions and WebSocket communication.
 *
 * Client Protocol:
 * - Send {"type": "init", "uuid": "uuid"} to initialize session
 * - Send {"type": "audio", "audio": "base64_encoded_audio"} to stream audio
 * - Receive {"type": "audio", "audio": "base64_encoded_audio"} for responses
 * - Receive {"type": "error", "message": "error_message"} for errors
 *
 * @author Agent Voice Response <info@agentvoiceresponse.com>
 * @see https://www.agentvoiceresponse.com
 */

const WebSocket = require("ws");
const { create } = require("@alexanderolsen/libsamplerate-js");
const { loadTools, getToolHandler } = require("./loadTools");

require("dotenv").config();

// Global resamplers (initialized once at startup)
let globalDownsampler = null;

// HumeAI API configuration
const HUMEAI_API_KEY = process.env.HUMEAI_API_KEY;
if (!HUMEAI_API_KEY) {
  console.error("ERROR: HUMEAI_API_KEY environment variable is required");
  process.exit(1);
}

const HUMEAI_WS_URL = process.env.HUMEAI_WS_URL || "wss://api.hume.ai/v0/evi/chat";
const HUMEAI_WELCOME_MESSAGE = process.env.HUMEAI_WELCOME_MESSAGE || "Hello, how can I help you today?";

const HUMEAI_INSTRUCTIONS = process.env.HUMEAI_INSTRUCTIONS || "You are an helpfull assistant";

/**
 * If the provider returns WAV data, remove the header and return raw PCM.
 * Searches for the "data" chunk so it works even if extra chunks are present.
 *
 * @param {Buffer} buffer - Audio buffer that may include a WAV header
 * @returns {Buffer} Raw PCM buffer (or original buffer if no header found)
 */
const stripWavHeader = (buffer) => {
  // Quick checks for RIFF/WAVE magic numbers
  if (
    !buffer ||
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return buffer;
  }

  let offset = 12; // Skip RIFF header to first chunk
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (chunkId === "data") {
      // Guard against malformed size
      const dataEnd = Math.min(dataStart + chunkSize, buffer.length);
      return buffer.slice(dataStart, dataEnd);
    }

    offset = dataStart + chunkSize;
  }

  // No data chunk found; return original to avoid data loss
  return buffer;
};


/**
 * Initializes global audio resamplers for format conversion.
 * AVR uses 8kHz, HumeAI uses 48kHz.
 */
const initializeResamplers = async () => {
  try {
    // Downsampler: HumeAI 48kHz → AVR 8kHz
    globalDownsampler = await create(1, 48000, 8000);
    console.log("Audio resamplers initialized successfully");
  } catch (error) {
    console.error("Failed to initialize resamplers:", error);
    throw error;
  }
};


/**
 * Converts audio from HumeAI format (48kHz) to AVR format (8kHz).
 *
 * @param {Buffer} audioBuffer48k - Audio buffer in 48kHz PCM 16-bit mono
 * @returns {Buffer} Audio buffer in 8kHz PCM 16-bit mono
 */
const convertProviderTo8k = (audioBuffer48k) => {
  if (!globalDownsampler || audioBuffer48k.length === 0) {
    return Buffer.alloc(0);
  }

  // Ensure we are working with raw PCM data
  const pcmBuffer = stripWavHeader(audioBuffer48k);

  const inputSamples = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.length / 2
  );

  const downsampledSamples = globalDownsampler.full(inputSamples);
  return Buffer.from(Int16Array.from(downsampledSamples).buffer);
};

/**
 * Handles incoming client WebSocket connection and manages communication with HumeAI's API.
 * Implements buffering for audio chunks received before WebSocket connection is established.
 *
 * @param {WebSocket} clientWs - Client WebSocket connection
 */
const handleClientConnection = (clientWs) => {
  console.log("New client WebSocket connection received");
  let sessionUuid = null;
  let ws = null;
  let audioBuffer = []; // Buffer for audio chunks received before HumeAI connection is ready
  
  /**
   * Initializes connection to HumeAI WebSocket API.
   */
  const initializeHumeAIConnection = () => {
    try {
      // Create WebSocket connection to HumeAI with authentication via query parameters
      let wsUrl = `${HUMEAI_WS_URL}?api_key=${HUMEAI_API_KEY}&session_settings[custom_session_id]=${sessionUuid}&session_settings[audio][channels]=1&session_settings[audio][encoding]=linear16&session_settings[audio][sample_rate]=8000`
      if (process.env.HUMEAI_CONFIG_ID) {
        console.log("Using config ID:", process.env.HUMEAI_CONFIG_ID);
        wsUrl += `&config_id=${process.env.HUMEAI_CONFIG_ID}`;
      } else {
        const systemPrompt = encodeURIComponent(HUMEAI_INSTRUCTIONS);
        wsUrl += `&session_settings[system_prompt]=${systemPrompt}`;
        if (process.env.HUMEAI_VOICE_ID) {
          console.log("Using voice ID:", process.env.HUMEAI_VOICE_ID);
          wsUrl += `&voice_id=${process.env.HUMEAI_VOICE_ID}`;
        }
      }
      // Load available tools for Hume
      try {
        const tools = loadTools();
        if (tools.length > 0) {
          const toolSchemas = encodeURIComponent(JSON.stringify(tools));
          wsUrl += `&tool_schemas=${toolSchemas}`;
          console.log(`Loaded ${tools.length} tools for Hume`);
        }
      } catch (error) {
        console.error(`Error loading tools for Hume: ${error.message}`);
      }
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log("Connected to HumeAI WebSocket API");
        // Send any buffered audio chunks
        if (audioBuffer.length > 0) {
          console.log(`Sending ${audioBuffer.length} buffered audio chunks`);
          audioBuffer.forEach((chunk) => {
            const audioMessage = {
              data: chunk.toString("base64"),
              type: "audio_input",
              custom_session_id: sessionUuid,
            };
            ws.send(JSON.stringify(audioMessage));
          });
          audioBuffer = [];
        }
        ws.send(JSON.stringify({ type: "assistant_input", custom_session_id: sessionUuid, text: HUMEAI_WELCOME_MESSAGE }));
      });

      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data);
          switch (message.type) {
            case "audio_output":
              const audioChunk = Buffer.from(message.data, "base64");
              clientWs.send(
                JSON.stringify({
                  type: "audio",
                  audio: convertProviderTo8k(audioChunk).toString("base64")
                })
              );
              break;
            case "user_interruption":
              console.log("User interruption");
              clientWs.send(JSON.stringify({ type: "interruption" }));
              break;
            case "user_message":
              console.log("User message:", message.message.content);
              const userData = {
                type: "transcript",
                role: "user",
                text: message.message.content,
              };
              clientWs.send(JSON.stringify(userData));
              break;
            case "assistant_message":
              console.log("Assistant message:", message.message.content);
              const agentData = {
                type: "transcript",
                role: "agent",
                text: message.message.content,
              };
              clientWs.send(JSON.stringify(agentData));
              break;
            case "tool_call":
              console.log("Tool call:", message);
              const handler = getToolHandler(message.name);
              if (!handler) {
                console.error(`No handler found for tool: ${message.name}`);
                const toolResponse = {
                  type: "tool_response",
                  tool_call_id: message.tool_call_id,
                  content: JSON.stringify({ error: `Tool ${message.name} not found` }),
                };
                ws.send(JSON.stringify(toolResponse));
                return;
              }

              try {
                // Execute the tool handler with the provided arguments
                const content = await handler(
                  sessionUuid,
                  JSON.parse(message.parameters)
                );
                console.log("Tool response:", content);
                const toolResponse = {
                  type: "tool_response",
                  tool_call_id: message.tool_call_id,
                  content: JSON.stringify(content),
                };
                ws.send(JSON.stringify(toolResponse));
              } catch (error) {
                // Handle errors during tool execution
                console.error(`Error executing tool ${message.name}:`, error);
                const toolResponse = {
                  type: "tool_response",
                  tool_call_id: message.tool_call_id,
                  content: JSON.stringify({ error: `Error executing tool ${message.name}: ${error.message}` }),
                };
                ws.send(JSON.stringify(toolResponse));
                return;
              }
              break;
            default:
              console.log("Unknown message type from HumeAI:", message.type);
              break;
          }
        } catch (error) {
          console.error("Error parsing HumeAI message:", error);
        }
      });
      

      ws.on("error", (error) => {
        console.error("HumeAI WebSocket error:", error);
        clientWs.send(
          JSON.stringify({
            type: "error",
            message: "Connection error with HumeAI API",
          })
        );
      });

      ws.on("close", () => {
        console.log("HumeAI WebSocket connection closed");
        cleanup();
      });
    } catch (error) {
      console.error("Failed to initialize HumeAI connection:", error);
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: "Failed to connect to HumeAI API",
        })
      );
    }
  };

  // Handle client WebSocket messages
  clientWs.on("message", (data) => {
    const message = JSON.parse(data);
      switch (message.type) {
        case "init":
          sessionUuid = message.uuid;
          console.log("Session UUID:", sessionUuid);
          initializeHumeAIConnection();
          break;

        case "audio":
          const audioBase64 = message.audio;              
          if (audioBase64) {
            if (ws && ws.readyState === WebSocket.OPEN) {
              const audioMessage = {
                data: audioBase64,
                type: "audio_input",
                custom_session_id: sessionUuid,
              };
              ws.send(JSON.stringify(audioMessage));
            } else {
              audioBuffer.push(audioBase64);
            }
          }
          break;

        default:
          console.log("Unknown message type from client:", message.type);
          break;
      }
  });

  // Handle client WebSocket close
  clientWs.on("close", () => {
    console.log("Client WebSocket connection closed");
    cleanup();
  });

  clientWs.on("error", (err) => {
    console.error("Client WebSocket error:", err);
    cleanup();
  });

  /**
   * Cleans up resources and closes connections.
   */
  function cleanup() {
    if (ws) {
      try {
        ws.close();
      } catch (error) {
        console.error("Error closing HumeAI connection:", error);
      }
      ws = null;
    }
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.close();
      } catch (error) {
        console.error("Error closing client connection:", error);
      }
    }
    audioBuffer = [];
  }
};

/**
 * Global cleanup function for graceful shutdown.
 */
const cleanupGlobalResources = () => {
  console.log("Cleaning up global resources...");
  // Resamplers don't need explicit cleanup, but we can nullify them
  globalDownsampler = null;
};

// Handle process termination signals
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...");
  cleanupGlobalResources();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  cleanupGlobalResources();
  process.exit(0);
});

// Initialize resamplers and start server
const startServer = async () => {
  try {
    // Validate environment variables
    if (!HUMEAI_API_KEY) {
      console.error("ERROR: HUMEAI_API_KEY environment variable is required");
      process.exit(1);
    }

    // Initialize audio resamplers
    await initializeResamplers();

    // Create WebSocket server
    const PORT = process.env.PORT || 6039;
    const wss = new WebSocket.Server({ port: PORT });

    wss.on("connection", (clientWs) => {
      console.log("New client connected");
      handleClientConnection(clientWs);
    });

    wss.on("error", (error) => {
      console.error("WebSocket server error:", error);
    });

    console.log(
      `HumeAI Speech-to-Speech WebSocket server running on port ${PORT}`
    );
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
