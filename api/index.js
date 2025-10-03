const archiver = require("archiver")
const cheerio = require("cheerio")
const fetch = require("node-fetch")
const stream = require("stream")
const { promisify } = require("util")
const pipeline = promisify(stream.pipeline)

const DROPBOX_TOKEN = process.env.DROPBOX_TOKEN

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  return await res.text()
}

async function fetchBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  return await res.buffer()
}

function absoluteUrl(base, relative) {
  try {
    return new URL(relative, base).toString()
  } catch {
    return null
  }
}

async function createZipFromPage(url) {
  const html = await fetchText(url)
  const $ = cheerio.load(html)

  const archive = archiver("zip", { zlib: { level: 9 } })
  const bufferStream = new stream.PassThrough()
  archive.pipe(bufferStream)

  archive.append(html, { name: "index.html" })

  const assets = []
  $("link[rel='stylesheet']").each((i, el) => {
    const u = absoluteUrl(url, $(el).attr("href"))
    if (u) assets.push({ url: u, name: `assets/style-${i}.css` })
  })
  $("script[src]").each((i, el) => {
    const u = absoluteUrl(url, $(el).attr("src"))
    if (u) assets.push({ url: u, name: `assets/script-${i}.js` })
  })
  $("img[src]").each((i, el) => {
    const u = absoluteUrl(url, $(el).attr("src"))
    if (u) assets.push({ url: u, name: `assets/image-${i}` })
  })

  for (let asset of assets) {
    try {
      const buf = await fetchBuffer(asset.url)
      archive.append(buf, { name: asset.name })
    } catch {}
  }

  await archive.finalize()

  const chunks = []
  for await (const chunk of bufferStream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function uploadToDropbox(fileBuffer, filename) {
  const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DROPBOX_TOKEN}`,
      "Dropbox-API-Arg": JSON.stringify({
        path: "/" + filename,
        mode: "overwrite",
        autorename: true
      }),
      "Content-Type": "application/octet-stream"
    },
    body: fileBuffer
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error("Dropbox upload failed: " + err)
  }

  const linkRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DROPBOX_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      path: "/" + filename,
      settings: { requested_visibility: "public" }
    })
  })

  const linkData = await linkRes.json()
  return linkData.url.replace("?dl=0", "?dl=1")
}

module.exports = async (req, res) => {
  try {
    const url = req.query.q
    if (!url) {
      res.status(400).json({ error: "Missing ?q=url" })
      return
    }

    const zipBuffer = await createZipFromPage(url)
    const filename = `site-${Date.now()}.zip`
    const link = await uploadToDropbox(zipBuffer, filename)

    res.status(200).json({ ok: true, downloadLink: link })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
