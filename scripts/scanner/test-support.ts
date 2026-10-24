import net from "node:net";
import { antivirusTestBytes } from "./clamd.js";
export async function daemon(reply: (command: string, bytes: Buffer) => string | Buffer | null) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    let buffer = Buffer.alloc(0), cmd = "", done = false; const parts: Buffer[] = [];
    socket.on("data", data => {
      if (done) return;
      buffer = Buffer.concat([buffer, data]);
      if (!cmd) { const i = buffer.indexOf(0); if (i < 0) return; cmd = buffer.subarray(0, i).toString(); buffer = buffer.subarray(i + 1); }
      if (cmd === "zINSTREAM") {
        while (buffer.length >= 4) {
          const length = buffer.readUInt32BE(0); if (buffer.length < length + 4) return;
          parts.push(buffer.subarray(4, length + 4)); buffer = buffer.subarray(length + 4);
          if (length === 0) { done = true; break; }
        }
        if (!done) return;
      } else done = true;
      const response = reply(cmd, Buffer.concat(parts));
      if (response !== null) socket.end(typeof response === "string" ? Buffer.from(response + "\0") : response);
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as net.AddressInfo).port, close: async () => { for (const s of sockets) s.destroy(); await new Promise<void>(r => server.close(() => r())); } };
}
const signatureTime = new Date();
export function version(date = signatureTime, signature = "27000") { return `ClamAV 1.4.6/${signature}/${date.toISOString()}| COMMANDS: PING VERSIONCOMMANDS INSTREAM`; }
export function healthyReply(cmd: string, bytes: Buffer) { return cmd === "zPING" ? "PONG" : cmd === "zVERSIONCOMMANDS" ? version() : bytes.includes(antivirusTestBytes()) ? "stream: Win.Test.EICAR_HDB-1 FOUND" : "stream: OK"; }
