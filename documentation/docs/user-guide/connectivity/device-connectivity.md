# Device Connectivity

Two protocols supported: MQTT (recommended for real-time) and HTTP (for periodic reporting).

## Access Tokens
Each entity gets a unique token via Connectivity tab > Provision Credential. Tokens authenticate device data submissions.

## Status Tracking
ONLINE, OFFLINE, UNKNOWN — tracked with last activity, protocol, source IP.

## Rate Limiting
Configurable per credential (default 600 messages/minute). IP allowlists optional.

## Code Snippets
Auto-generated connection code in Python, Node.js, C, and curl.
