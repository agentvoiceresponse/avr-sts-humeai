<div align="center">

# Agent Voice Response × HumeAI

[![Discord](https://img.shields.io/discord/1347239846632226998?label=Discord&logo=discord)](https://discord.gg/DFTU69Hg74)
[![GitHub Repo stars](https://img.shields.io/github/stars/agentvoiceresponse/avr-sts-humeai?style=social)](https://github.com/agentvoiceresponse/avr-sts-humeai)
[![Docker Pulls](https://img.shields.io/docker/pulls/agentvoiceresponse/avr-sts-humeai?label=Docker%20Pulls&logo=docker)](https://hub.docker.com/r/agentvoiceresponse/avr-sts-humeai)
[![Ko-fi](https://img.shields.io/badge/Support%20us%20on-Ko--fi-ff5e5b.svg)](https://ko-fi.com/agentvoiceresponse)

<br/>

<table>
<tr>
<td align="center" width="200">
<img src="img/avr.png" alt="Agent Voice Response" width="180"/>
</td>
<td align="center" valign="middle" width="100">
<h1>×</h1>
</td>
<td align="center" width="200">
<img src="img/hume.webp" alt="Hume AI" width="180"/>
</td>
</tr>
</table>

</div>

---

This repository showcases the integration between **Agent Voice Response** and **HumeAI's Empathic Voice Interface (EVI)** using speech-to-speech technology. The application provides a WebSocket server that handles real-time bidirectional audio streaming between clients (such as Asterisk) and Hume's EVI API, enabling natural voice conversations with automatic audio format conversions.

## Prerequisites

To set up and run this project, you will need:

1. **Node.js** (v16 or higher) and **npm** installed
2. A **Hume AI API key** with access to the Empathic Voice Interface (EVI)
3. Optional: A **Hume Config ID** for customized voice configurations

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/agentvoiceresponse/avr-sts-humeai.git
cd avr-sts-humeai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root of the project with the following variables:

```bash
HUME_API_KEY=your_hume_api_key
HUME_CONFIG_ID=your_hume_config_id  # Optional - for custom voice configurations
PORT=6035  # Optional - default is 6035
```

### 4. Running the Application

#### Development Mode (with auto-reload)

```bash
npm run start:dev
```

#### Production Mode

First, build the TypeScript code:

```bash
npm run build
```

Then start the server:

```bash
npm start
```

The WebSocket server will start on the port defined in the environment variable (default: 6035).

## How It Works

The **Agent Voice Response** system acts as a WebSocket proxy between clients (typically Asterisk PBX or other telephony systems) and Hume's Empathic Voice Interface API. It handles:

1. **Audio Format Conversion**: Upsamples client audio from 8kHz to 48kHz for Hume, and downsamples Hume's responses from 48kHz back to 8kHz for the client
2. **WebSocket Management**: Maintains bidirectional WebSocket connections between client and Hume
3. **Message Queuing**: Queues audio messages until Hume connection is established
4. **Audio Chunking**: Splits audio into optimal 100ms chunks for Hume's API

### Key Components

- **WebSocket Server**: Accepts incoming client connections on the configured port
- **Hume SDK Integration**: Uses the official Hume SDK to connect to EVI API
- **Audio Resampler**: Utilizes the `avr-resampler` package for efficient audio format conversion
- **Real-time Streaming**: Processes and streams audio data with minimal latency

### Audio Flow

```
Client (8kHz PCM) → Upsample to 48kHz → Hume EVI API
                                              ↓
Client (8kHz PCM) ← Downsample to 8kHz ← Hume Response (48kHz)
```

## WebSocket Protocol

### Client Connection

Connect to the WebSocket server:

```
ws://localhost:6035
```

### Message Format

All messages are JSON-encoded with the following structure:

#### 1. Initialize Connection

Send this message first to establish the Hume connection:

```json
{
  "type": "init"
}
```

#### 2. Send Audio Data

Send audio chunks to be processed by Hume:

```json
{
  "type": "audio",
  "audio": "base64_encoded_audio_data"
}
```

**Audio Requirements:**

- Format: 16-bit PCM
- Sample Rate: 8kHz
- Channels: Mono
- Encoding: Base64

#### 3. Receive Audio Response

The server sends back Hume's audio response in the same format:

```json
{
  "type": "audio",
  "audio": "base64_encoded_audio_data"
}
```

**Audio Format:**

- Format: 16-bit PCM
- Sample Rate: 8kHz (downsampled from Hume's 48kHz)
- Channels: Mono
- Encoding: Base64

## Docker Support

### Build Docker Image

```bash
npm run dc:build
```

### Run with Docker

```bash
docker run -d \
  -p 6035:6035 \
  -e HUME_API_KEY=your_api_key \
  -e HUME_CONFIG_ID=your_config_id \
  agentvoiceresponse/avr-sts-humeai:latest
```

## Environment Variables

You can customize the application behavior using the following environment variables:

| Variable         | Required | Default | Description                                          |
| ---------------- | -------- | ------- | ---------------------------------------------------- |
| `HUME_API_KEY`   | ✅ Yes   | -       | Your Hume AI API key                                 |
| `HUME_CONFIG_ID` | ❌ No    | -       | Optional Hume EVI configuration ID for custom voices |
| `PORT`           | ❌ No    | 6035    | WebSocket server port                                |

## Error Handling

The application includes comprehensive error handling for:

- WebSocket connection failures (both client and Hume)
- Audio processing errors (resampling, format conversion)
- Hume API errors (invalid credentials, rate limits)
- Message parsing errors
- Graceful shutdown on SIGINT/SIGTERM

All errors are logged to the console with detailed context information.

## Project Structure

```
avr-sts-humeai/
├── src/
│   ├── index.ts          # Main server and WebSocket logic
│   └── lib.ts            # Utility functions (WAV header processing)
├── dist/                 # Compiled JavaScript (generated)
├── Dockerfile            # Docker container configuration
├── package.json          # Node.js dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── .env                  # Environment variables (create this)
```

## Testing

### WebRTC Phone for Testing

If you need a WebRTC-based SIP phone to test this integration with Asterisk, check out this modern browser-based phone:

🌐 **[WebRTC Phone](https://github.com/mirkobertone/webrtc-phone)**

A clean, minimal WebRTC phone built with React and TypeScript that works perfectly for testing voice AI integrations. Features include:

- Modern, responsive UI with smooth animations
- WebSocket transport support (WS/WSS)
- Easy SIP account configuration
- Works directly in your browser
- Perfect for testing AVR integrations with Hume AI

Simply configure it to connect to your Asterisk server and start testing your Hume EVI integration!

## Support & Community

- **GitHub:** [https://github.com/agentvoiceresponse](https://github.com/agentvoiceresponse) - Report issues, contribute code.
- **Discord:** [https://discord.gg/DFTU69Hg74](https://discord.gg/DFTU69Hg74) - Join the community discussion.
- **Docker Hub:** [https://hub.docker.com/u/agentvoiceresponse](https://hub.docker.com/u/agentvoiceresponse) - Find Docker images.
- **NPM:** [https://www.npmjs.com/~agentvoiceresponse](https://www.npmjs.com/~agentvoiceresponse) - Browse our packages.
- **Wiki:** [https://wiki.agentvoiceresponse.com/en/home](https://wiki.agentvoiceresponse.com/en/home) - Project documentation and guides.

## Support AVR

AVR is free and open-source. If you find it valuable, consider supporting its development:

<a href="https://ko-fi.com/agentvoiceresponse" target="_blank"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support us on Ko-fi"></a>

## License

MIT License - see the [LICENSE](LICENSE.md) file for details.
