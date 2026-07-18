// Bun's `with { type: "file" }` import returns a path to the file, and embeds
// the file itself when the server is compiled into a standalone binary.
// Note the path is inside Bun's virtual filesystem in that case, so it is
// readable by this process but not by a spawned one — see materializeBridge().
declare module "*.py" {
  const path: string;
  export default path;
}
