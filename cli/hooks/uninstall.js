#!/usr/bin/env node

/**
 * Uninstall hook — clean up system modifications made by postinstall.js.
 *
 * Removes:
 *   1. Autostart entries (macOS launchd plist, Windows schtask, Linux .desktop)
 *   2. Runtime data directory (~/.9router or %APPDATA%/9router)
 *   3. User config (optional, kept by default)
 *
 * This hook is called via `npm uninstall` when `scripts.uninstall` is set
 * in package.json, and e.g. `npm rm -g 9router` triggers it automatically.
 *
 * Environment:
 *   - `9ROUTER_UNINSTALL_KEEP_CONFIG=1` → skip deleting data dir (keep settings)
 *   - `9ROUTER_UNINSTALL_SILENT=1` → suppress non-error output
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const APP_LABEL = "com.9router.autostart";
const APP_NAME = "9router";

const SILENT = !!process.env["9ROUTER_UNINSTALL_SILENT"];
const KEEP_CONFIG = !!process.env["9ROUTER_UNINSTALL_KEEP_CONFIG"];

function log(msg, err = false) {
  if (SILENT && !err) return;
  console.log(`[9router][uninstall] ${msg}`);
}

function warn(msg) {
  log(`⚠ ${msg}`, true);
}

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "9router")
    : path.join(os.homedir(), ".9router");
}

function getRuntimeDir() {
  return path.join(getDataDir(), "runtime");
}

// ── macOS ───────────────────────────────────────────────────────────
function disableMacOSAutostart() {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl bootout gui/${process.getuid?.() ?? 501}/${APP_LABEL} 2>/dev/null || true`, { stdio: "ignore" });
    } catch { /* best effort */ }
    try { fs.unlinkSync(plistPath); log("Removed macOS autostart plist"); } catch (e) { warn(`Failed to remove plist: ${e.message}`); }
  } else {
    log("macOS autostart not found, skipping");
  }
}

// ── Linux ───────────────────────────────────────────────────────────
function disableLinuxAutostart() {
  const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_LABEL}.desktop`);
  if (fs.existsSync(desktopPath)) {
    try { fs.unlinkSync(desktopPath); log("Removed Linux autostart .desktop"); } catch (e) { warn(`Failed to remove .desktop: ${e.message}`); }
  } else {
    log("Linux autostart not found, skipping");
  }
}

// ── Windows ─────────────────────────────────────────────────────────
function disableWindowsAutostart() {
  try {
    const result = execSync(
      `schtasks /query /tn "9router" 2>nul || echo NOT_FOUND`,
      { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 10000 }
    );
    if (!result.includes("NOT_FOUND")) {
      execSync(`schtasks /delete /tn "9router" /f 2>nul`, { stdio: "ignore", timeout: 10000 });
      log("Removed Windows scheduled task autostart");
    } else {
      log("Windows autostart not found, skipping");
    }
  } catch { /* best effort */ }
}

// ── Cleanup data dir ───────────────────────────────────────────────
function cleanupDataDir() {
  if (KEEP_CONFIG) {
    log("Keeping config (9ROUTER_UNINSTALL_KEEP_CONFIG=1)");
    // Remove only the runtime subdir (recreatable), keep user config
    const runtimeDir = getRuntimeDir();
    if (fs.existsSync(runtimeDir)) {
      try { fs.rmSync(runtimeDir, { recursive: true, force: true }); log("Removed runtime deps"); } catch (e) { warn(`Failed to remove runtime: ${e.message}`); }
    }
    return;
  }

  const dataDir = getDataDir();
  if (fs.existsSync(dataDir)) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); log("Removed data directory"); } catch (e) { warn(`Failed to remove data dir: ${e.message}`); }
  } else {
    log("Data directory not found, nothing to clean");
  }
}

// ── Main ────────────────────────────────────────────────────────────
function main() {
  const platform = process.platform;
  log(`Running uninstall hook (platform: ${platform})`);

  // 1. Disable autostart
  if (platform === "darwin") disableMacOSAutostart();
  else if (platform === "win32") disableWindowsAutostart();
  else if (platform === "linux") disableLinuxAutostart();

  // 2. Remove runtime / data dir
  cleanupDataDir();

  log("Uninstall cleanup complete");
}

main();
