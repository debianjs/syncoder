import fetch from "node-fetch";
import AdmZip from "adm-zip";
import { Dropbox } from "dropbox";

export default async function handler(req, res) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Missing ?q=url parameter" });

    const response = await fetch(q);
    if (!response.ok) throw new Error("Failed to fetch target URL");

    const html = await response.text();
    const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join("\n") || "";
    const js = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)?.join("\n") || "";

    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from(html));
    if (css) zip.addFile("styles.css", Buffer.from(css));
    if (js) zip.addFile("scripts.js", Buffer.from(js));

    const zipBuffer = zip.toBuffer();

    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN, fetch });

    const uploadPath = `/extract_${Date.now()}.zip`;
    await dbx.filesUpload({
      path: uploadPath,
      contents: zipBuffer,
      mode: "overwrite"
    });

    const shared = await dbx.sharingCreateSharedLinkWithSettings({
      path: uploadPath
    });

    const directLink = shared.result.url.replace("?dl=0", "?dl=1");

    res.status(200).json({ directLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
