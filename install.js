/*
    This script fetches the latest release info from your Go repo, downloads the correct binary for the user's OS/CPU, and places it neatly into the bin/ folder so npm makes it globally available.
 */

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");
const { extract } = require("tar");

const BIN_DIR = path.join(__dirname, "bin");
const BIN_PATH = path.join(
  BIN_DIR,
  process.platform === "win32" ? "projscan.exe" : "projscan",
);

// Map Node's process.platform/arch to Go's GOOS/GOARCH
const PLATFORM_MAP = { win32: "windows", linux: "linux", darwin: "darwin" };
const ARCH_MAP = { x64: "amd64", arm64: "arm64", arm: "arm" };

function findBinary(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isFile() &&
      (entry.name === "projscan" || entry.name === "projscan.exe")
    ) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const subFiles = fs.readdirSync(fullPath);
      for (const sub of subFiles) {
        if (sub === "projscan" || sub === "projscan.exe") {
          return path.join(fullPath, sub);
        }
      }
    }
  }
  return null;
}

async function install() {
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];

  if (!platform || !arch) {
    console.error(
      `❌ Unsupported platform: ${process.platform} ${process.arch}`,
    );
    process.exit(1);
  }

  console.log(`✅ Detected: ${platform} / ${arch}`);

  // 1. Fetch the latest release tag from GitHub
  const apiUrl =
    "https://api.github.com/repos/abubakar-sadiq001/projscan/releases/latest";
  console.log(`🔍 Checking for latest release...`);

  let release;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        // Optional: Add a token if you hit rate limits (60 req/hour for unauthenticated)
        // 'Authorization': `token ${process.env.GITHUB_TOKEN}`
      },
    });
    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);
    release = await res.json();
  } catch (err) {
    console.error(`❌ Failed to fetch latest release: ${err.message}`);
    console.error("   Make sure you are connected to the internet.");
    process.exit(1);
  }

  const tag = release.tag_name; // e.g., "v1.2.3"
  const version = tag.replace(/^v/, ""); // e.g., "1.2.3"
  const assetName = `projscan_${version}_${platform}_${arch}.tar.gz`;
  const downloadUrl = `https://github.com/abubakar-sadiq001/projscan/releases/download/${tag}/${assetName}`;

  console.log(`📦 Downloading: ${assetName}`);

  // 2. Download the tarball
  const tarballRes = await fetch(downloadUrl);
  if (!tarballRes.ok) {
    console.error(`❌ Failed to download binary (HTTP ${tarballRes.status})`);
    console.error(`   URL attempted: ${downloadUrl}`);
    console.error(
      "   Make sure this asset exists in the latest GitHub Release.",
    );
    process.exit(1);
  }

  // 3. Prepare the bin directory
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // 4. Extract the tarball
  console.log(`📂 Extracting to ${BIN_DIR}...`);
  try {
    // Pipe the response body directly into tar.extract
    await pipeline(
      tarballRes.body,
      extract({
        cwd: BIN_DIR,
        // If GoReleaser packages the binary inside a folder, this finds it.
      }),
    );

    // 5. Locate the extracted binary (handles root or subfolder)
    const extractedBinary = findBinary(BIN_DIR);
    if (!extractedBinary) {
      console.error(
        '❌ Could not find "projscan" or "projscan.exe" inside the tarball.',
      );
      process.exit(1);
    }

    // 6. Rename/move it to the exact path npm expects
    if (extractedBinary !== BIN_PATH) {
      fs.renameSync(extractedBinary, BIN_PATH);
      // Clean up any empty subfolders left behind
      const parentDir = path.dirname(extractedBinary);
      if (parentDir !== BIN_DIR && fs.existsSync(parentDir)) {
        fs.rmdirSync(parentDir, { recursive: true });
      }
    }

    // 7. Set executable permissions (Unix/Mac)
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(BIN_PATH, 0o755);
      } catch (_) {
        /* ignore */
      }
    }

    console.log(`✅ Successfully installed ProjScan to ${BIN_PATH}`);
    console.log(`🎉 Run "projscan --version" to verify.`);
  } catch (err) {
    console.error(`❌ Extraction failed:`);
    console.error(err);
    process.exit(1);
  }
}

install();
