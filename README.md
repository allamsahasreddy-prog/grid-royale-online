# Grid Royale — Online Tic Tac Toe

A responsive Classic + Ultimate Tic Tac Toe game with local play and private online rooms. A player creates a room, shares its six-character code or invite URL, and a friend joins from another device.

## Features

- Professional landing page and game lobby
- Private six-character room codes and shareable invite links
- Real-time Classic 3×3 and Ultimate 9×9 matches using Socket.IO
- Server-side move validation and turn enforcement
- Room creator / second-player roles, waiting state, connection status and reconnect support
- Undo the latest move before the other player makes a move
- Room creator can start another round while the room score is retained
- Offline two-player and vs-computer play
- Easy, Medium and Hard local computer opponents
- Four themes, sound toggle, fullscreen, winning-cell effects, confetti and responsive layout
- Offline scores and recent match history saved in the browser
- No account or email address required; display names are limited to 18 characters

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:10000` in your browser. To test multiplayer on one computer, open the page in two separate browser windows or profiles. Create a room in one, then join with its code in the other.

## Put it online (Render example)

The app needs a web server for real-time rooms. Do not upload only `public/index.html` as a static site; the Socket.IO server is required.

1. Create a new Git repository and upload the contents of this project folder (the `package.json`, `server.js`, `render.yaml`, README and `public` folder should be at the repository root).
2. In Render, create a **Web Service** and connect that repository.
3. Use the Node runtime. The included `render.yaml` specifies `npm install`, `npm start`, and `/healthz` as the health check.
4. Deploy. Render will provide a public `onrender.com` address. Open that address, create a room, and send the invite link or six-character code to your friend.

Render documentation:
- https://render.com/docs/web-services
- https://render.com/docs/websocket
- https://render.com/docs/your-first-deploy

A free Render web service is useful for testing, but it can spin down after 15 minutes without activity. The first visit after inactivity may take a little while to wake up. See https://render.com/docs/free for current limitations.

## Important room behaviour

- Rooms are temporary and held in server memory. Deploy restarts clear active rooms and room scores.
- A room closes after both players have disconnected for two minutes.
- The room creator is X; the joining player is O.
- Both players must be connected before moves are accepted.
- The room creator controls starting the next round. Scores remain for the life of that room.
- Online play does not require account registration. Use a nickname only, not personal or sensitive information.

For a larger public launch, the next engineering step would be persistent room storage and a shared Socket.IO adapter (for example Redis) so rooms survive server restarts and can span multiple server instances.
## webpage
you can visit the web page on https://grid-royale-online.onrender.com/
